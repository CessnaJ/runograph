/// <reference lib="webworker" />
import { Archive, LIMITS } from "../core/archive";
import { profile } from "../core/metrics";
import { qualityIssues } from "../core/quality";
import { saveDetail, discardGeneration } from "../core/storage";
import type {
  InternalSummary,
  Detail,
  Profile,
  Summary,
  WorkerRequest,
  WorkerResponse,
} from "../core/types";
let archive: Archive | null = null;
let summaries: InternalSummary[] = [];
const send = (message: WorkerResponse) => self.postMessage(message);
async function handle(msg: WorkerRequest) {
  try {
    if (msg.type === "IMPORT") {
      if (archive) await archive.close();
      archive = null;
      summaries = [];
      const result = await Archive.open(msg.file, (phase, percent) =>
        send({ type: "PROGRESS", requestId: msg.requestId, phase, percent }),
      );
      archive = result.archive;
      summaries = result.sessions;
      const profiles: Profile[] = [];
      let samples = 0;
      const warnings = [...result.warnings];
      if (msg.file.size > 256 * 1024 ** 2)
        warnings.push(
          "큰 파일이라 기기 메모리를 많이 써요. 분석이 멈추면 다른 탭을 닫고 다시 시도해 주세요.",
        );
      for (let i = 0; i < summaries.length; i++) {
        const summary = summaries[i];
        if (summary.status === "pending") {
          if (samples >= LIMITS.profileSamples) {
            summary.status = "limited";
            continue;
          }
          try {
            const detail = await archive.detail(summary);
            summary.quality = qualityIssues(summary, detail);
            summary.issues.push(
              ...summary.quality
                .map((q) => q.code)
                .filter((c) => !summary.issues.includes(c)),
            );
            samples += detail.points.length;
            const p = profile(detail);
            // v0.2 sends compact timed windows; legacy bins stay out of React state.
            p.bins = [];
            profiles.push(p);
            summary.status = "ready";
            summary.issues.push(...detail.issues);
          } catch (error) {
            summary.status = "invalid";
            summary.issues.push(
              error instanceof Error && /제한/.test(error.message)
                ? "size-limit"
                : "detail-invalid",
            );
          }
        }
        send({
          type: "PROGRESS",
          requestId: msg.requestId,
          phase: `러닝 분석 중 · ${i + 1} / ${summaries.length}`,
          percent: 15 + Math.round(((i + 1) / summaries.length) * 85),
        });
      }
      if (summaries.some((s) => s.status === "limited"))
        warnings.push(
          "파일이 커서 일부 기록만 비교 분석했어요. 아직 분석하지 않은 러닝도 개별 기록을 열면 볼 수 있어요.",
        );
      const sessions: Summary[] = summaries.map(
        ({ reference, uuid, updatedMs, ...s }) => {
          void reference;
          void uuid;
          void updatedMs;
          return s;
        },
      );
      send({
        type: "DATA",
        requestId: msg.requestId,
        data: { sessions, profiles, warnings, revision: msg.requestId },
      });
    } else if (msg.type === "SAVE") {
      if (!archive) throw new Error("ZIP을 다시 선택해 주세요.");
      try {
        let points = 0;
        for (let i = 0; i < summaries.length; i++) {
          const summary = summaries[i];
          if (summary.status === "ready" || summary.status === "limited") {
            archive.newReadBudget();
            const detail = await archive.detail(summary);
            points += detail.points.length;
            if (points > LIMITS.profileSamples + 100000)
              throw new Error(
                "기록이 많아 이 기기에 보관하지 못했어요. ZIP으로 계속 볼 수 있어요.",
              );
            await saveDetail(msg.generation, detail);
          }
          send({
            type: "SAVE_PROGRESS",
            requestId: msg.requestId,
            count: i + 1,
            total: summaries.length,
          });
        }
        send({
          type: "SAVED",
          requestId: msg.requestId,
          generation: msg.generation,
        });
      } catch (error) {
        await discardGeneration(msg.generation).catch(() => {});
        throw error;
      }
    } else if (msg.type === "PAIR") {
      if (!archive) throw new Error("ZIP을 다시 선택해 주세요.");
      const details: Detail[] = [];
      for (const id of msg.ids) {
        const summary = summaries.find((s) => s.id === id);
        if (!summary) throw new Error("이 러닝을 찾지 못했어요.");
        archive.newReadBudget();
        details.push(await archive.detail(summary));
      }
      send({
        type: "PAIR",
        requestId: msg.requestId,
        details: details as [Detail, Detail],
      });
    } else {
      const summary = summaries.find((s) => s.id === msg.id);
      if (!archive || !summary) throw new Error("ZIP을 다시 선택해 주세요.");
      archive.newReadBudget();
      send({
        type: "DETAIL",
        requestId: msg.requestId,
        detail: await archive.detail(summary),
      });
    }
  } catch (error) {
    send({
      type: "ERROR",
      requestId: msg.requestId,
      message:
        error instanceof Error
          ? error.message
          : "분석을 마치지 못했어요. ZIP 파일을 다시 선택해 주세요.",
    });
  }
}

// Serialize archive reads and retain only the newest queued detail request.
let pending: WorkerRequest[] = [];
let running = false;
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "DETAIL" || event.data.type === "PAIR")
    pending = pending.filter((p) => p.type !== event.data.type);
  pending.push(event.data);
  if (!running) void drain();
};
async function drain() {
  running = true;
  while (pending.length) {
    const msg = pending.shift()!;
    await handle(msg);
  }
  running = false;
}
