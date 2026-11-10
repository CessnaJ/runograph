import Papa from "papaparse";
import {
  parseActivity,
  ACTIVITY_LIMITS,
  type ActivityFormat,
  type ParsedActivity,
} from "./activity";
import { parseNike } from "./nike";
import { qualityIssues } from "./quality";
import type { ImportSource, InternalSummary } from "./types";

export interface ActivityInput {
  name: string;
  read: () => Promise<Uint8Array>;
}

export function activityFormat(
  data: Uint8Array,
): ActivityFormat | "nike" | null {
  if (data.length >= 12 && String.fromCharCode(...data.slice(8, 12)) === ".FIT")
    return "fit";
  const head = new TextDecoder()
    .decode(data.slice(0, 8192))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (/^[{[]/.test(head)) return "nike";
  if (/<(?:[\w.-]+:)?gpx\b/.test(head)) return "gpx";
  if (/<(?:[\w.-]+:)?TrainingCenterDatabase\b/.test(head)) return "tcx";
  return null;
}

export async function uncompressActivity(
  data: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("분석을 취소했어요.");
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ACTIVITY_LIMITS.bytes)
        throw new Error("압축을 푼 운동 파일이 128 MB 제한을 넘었어요.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// The index is used only to select running files; account details, titles, IDs,
// comments and unit-ambiguous summary columns never leave this function.
export function stravaRunningFiles(text: string): Set<string> {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  const header = parsed.data.shift()?.map((h) => h.trim().toLowerCase());
  const filename = header?.indexOf("filename") ?? -1;
  const sport = header?.indexOf("activity type") ?? -1;
  if (
    parsed.errors.length ||
    filename < 0 ||
    sport < 0 ||
    parsed.data.length > 50000
  )
    throw new Error(
      "Strava 활동 목록의 형식을 읽을 수 없어요. 원본 전체 ZIP이나 개별 운동 파일을 선택해 주세요.",
    );
  const files = new Set<string>();
  for (const row of parsed.data) {
    if (
      !/^(?:run|running|trail run|trailrun|virtual run|treadmill)$/i.test(
        row[sport]?.trim() ?? "",
      )
    )
      continue;
    const path = row[filename]?.trim().replace(/^\.\//, "");
    if (path) files.add(path);
  }
  return files;
}

export class ActivityStore {
  source: ImportSource = "activity";
  sessions: InternalSummary[] = [];
  warnings: string[] = [];
  private references = new Map<string, { file: number; id: string }>();
  private last: { file: number; parsed: ParsedActivity } | null = null;
  private opening = true;
  private decodedBytes = 0;
  private constructor(
    private files: ActivityInput[],
    private strava: boolean,
    private signal?: AbortSignal,
  ) {}

  static async open(
    files: ActivityInput[],
    strava: boolean,
    progress: (phase: string, percent: number) => void,
    signal?: AbortSignal,
  ) {
    const store = new ActivityStore(files, strava, signal);
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) throw new Error("분석을 취소했어요.");
      try {
        const parsed = await store.parse(i);
        for (const session of parsed.sessions) {
          if (store.sessions.length >= 50000)
            throw new Error("러닝 기록이 5만 개 제한을 넘었어요.");
          const id = `run-${store.sessions.length + 1}`;
          const detail = parsed.details.find((d) => d.id === session.id);
          store.references.set(id, { file: i, id: session.id });
          store.sessions.push({
            ...session,
            id,
            reference: null,
            uuid: null,
            updatedMs: null,
            detailAvailable: !!detail,
            status: detail ? "pending" : "missing",
          });
        }
        store.warnings.push(...parsed.warnings);
      } catch (error) {
        if (
          signal?.aborted ||
          files.length === 1 ||
          (error instanceof Error && /제한|암호|경로/.test(error.message))
        )
          throw error;
        failed++;
      }
      progress(
        `운동 파일 확인 · ${i + 1} / ${files.length}`,
        1 + Math.round(((i + 1) / files.length) * 13),
      );
    }
    store.opening = false;
    if (!store.sessions.length)
      throw new Error(
        "지원하는 러닝 기록을 찾지 못했어요. 러닝의 원본 FIT·TCX·GPX 또는 Nike 활동 JSON을 선택해 주세요.",
      );
    const sources = new Set(store.sessions.map((s) => s.source));
    store.source = strava
      ? "strava"
      : sources.size === 1
        ? [...sources][0]!
        : "activity";
    if (failed)
      store.warnings.push(
        `지원하지 않거나 손상된 운동 파일 ${failed}개를 읽지 못했어요. 나머지 기록을 불러왔어요.`,
      );
    // Different exports of one run can overlap. Keep both visible and require
    // confirmation before adding their totals twice.
    const sorted = [...store.sessions].sort((a, b) => a.startMs - b.startMs);
    let furthest: InternalSummary | undefined;
    for (const s of sorted) {
      if (furthest?.endMs && s.startMs < furthest.endMs) {
        for (const run of [s, furthest]) {
          if (!run.issues.includes("activity-overlap"))
            run.issues.push("activity-overlap");
          run.quality = [
            ...(run.quality ?? []).filter((q) => q.code !== "activity-overlap"),
            ...qualityIssues(run).filter((q) => q.code === "activity-overlap"),
          ];
        }
      }
      if (s.endMs && (!furthest?.endMs || s.endMs > furthest.endMs))
        furthest = s;
    }
    store.sessions.sort((a, b) => b.startMs - a.startMs);
    store.warnings = [...new Set(store.warnings)];
    return store;
  }

  private async parse(file: number): Promise<ParsedActivity> {
    if (this.last?.file === file) return this.last.parsed;
    const data = await uncompressActivity(
      await this.files[file].read(),
      this.signal,
    );
    if (this.opening) {
      this.decodedBytes += data.byteLength;
      if (this.decodedBytes > ACTIVITY_LIMITS.bytes)
        throw new Error(
          "운동 파일의 전체 압축 해제 크기가 128 MB 제한을 넘었어요.",
        );
    }
    const format = activityFormat(data);
    if (!format)
      throw new Error(
        "이 운동 파일의 형식은 아직 지원하지 않아요. 원본 FIT·TCX·GPX 또는 Nike 활동 JSON을 선택해 주세요.",
      );
    const parsed =
      format === "nike"
        ? parseNike(new TextDecoder("utf-8", { fatal: true }).decode(data))
        : parseActivity(data, format, this.strava ? "strava" : "activity");
    this.last = { file, parsed };
    return parsed;
  }
  async detail(summary: InternalSummary) {
    const reference = this.references.get(summary.id);
    if (!reference || summary.detailAvailable === false)
      throw new Error(
        "이 기록에는 시간별 측정값이 없어요. 러닝 요약만 볼 수 있어요.",
      );
    const parsed = await this.parse(reference.file);
    const detail = parsed.details.find((d) => d.id === reference.id);
    if (!detail) throw new Error("이 기록의 시간별 측정값을 찾지 못했어요.");
    return { ...detail, id: summary.id };
  }
  close() {
    this.last = null;
    this.references.clear();
    this.files = [];
  }
}
