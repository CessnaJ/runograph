/// <reference lib="webworker" />
import { Archive, LIMITS } from "../core/archive";
import { profile } from "../core/metrics";
import type {
  InternalSummary,
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
          "큰 파일입니다. 휴대폰 메모리가 부족하면 탭이 종료될 수 있습니다.",
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
            samples += detail.points.length;
            const p = profile(detail);
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
          phase: `러닝 분석 · ${i + 1} / ${summaries.length}`,
          percent: 15 + Math.round(((i + 1) / summaries.length) * 85),
        });
      }
      if (summaries.some((s) => s.status === "limited"))
        warnings.push(
          "메모리 보호를 위해 성장 분석의 표본 수를 제한했습니다. 개별 기록은 다시 읽을 수 있습니다.",
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
        data: { sessions, profiles, warnings },
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
          : "분석을 완료하지 못했습니다. 파일을 다시 선택해 주세요.",
    });
  }
}

// Serialize archive reads and retain only the newest queued detail request.
let pending: WorkerRequest | null = null;
let running = false;
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  pending = event.data;
  if (!running) void drain();
};
async function drain() {
  running = true;
  while (pending) {
    const msg = pending;
    pending = null;
    await handle(msg);
  }
  running = false;
}
