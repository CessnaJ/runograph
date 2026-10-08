import Papa from "papaparse";
import type { Detail, InternalSummary, Point } from "./types";
import { qualityIssues } from "./quality";
const prefix = "com.samsung.health.exercise.";
const keys = [
  "start_time",
  "end_time",
  "duration",
  "distance",
  "mean_heart_rate",
  "max_heart_rate",
  "mean_cadence",
  "exercise_type",
  "time_offset",
  "live_data",
  "datauuid",
  "update_time",
  "deviceuuid",
] as const;
export function numeric(value: unknown, zero = true): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (
    typeof value === "string" &&
    (!value.trim() || /^(null|undefined)$/i.test(value.trim()))
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) && (zero ? n >= 0 : n > 0) ? n : null;
}
export function parseUtc(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(
      text,
    );
  if (m) {
    const [, y, mo, d, h, mi, s, frac] = m;
    const ms = Number((frac ?? "").slice(0, 3).padEnd(3, "0"));
    const parts = [
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
      ms,
    ];
    const time = Date.UTC(
      ...(parts as [number, number, number, number, number, number, number]),
    );
    const dt = new Date(time);
    return dt.getUTCFullYear() === parts[0] &&
      dt.getUTCMonth() === parts[1] &&
      dt.getUTCDate() === parts[2] &&
      dt.getUTCHours() === parts[3] &&
      dt.getUTCMinutes() === parts[4] &&
      dt.getUTCSeconds() === parts[5]
      ? time
      : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const n = Date.parse(text);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
export function parseOffset(value: unknown): number | null {
  // Numeric offset units are not inferred for unverified export schemas.
  if (typeof value !== "string") return null;
  const m = /^(?:UTC)?([+-])(\d{2}):?(\d{2})$/.exec(value.trim());
  if (
    !m ||
    Number(m[2]) > 14 ||
    Number(m[3]) > 59 ||
    (Number(m[2]) === 14 && Number(m[3]) !== 0)
  )
    return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000;
}
export function localDate(time: number, offset: number | null): string {
  return new Date(time + (offset ?? 0)).toISOString().slice(0, 10);
}
export function parseExerciseCsv(text: string): {
  sessions: InternalSummary[];
  warnings: string[];
} {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error(
      "운동 기록 파일의 형식이 맞지 않아요. 삼성헬스에서 다시 다운로드한 ZIP을 선택해 주세요.",
    );
  const rows = parsed.data;
  if (
    rows[0]?.[0]?.trim() === "com.samsung.shealth.exercise" ||
    rows[0]?.[0]?.trim() === "com.samsung.health.exercise"
  )
    rows.shift();
  const header = rows.shift()?.map((x) => x.trim());
  if (!header)
    throw new Error(
      "운동 기록 파일이 비어 있어요. 삼성헬스에서 다시 다운로드한 ZIP을 선택해 주세요.",
    );
  if (new Set(header).size !== header.length)
    throw new Error(
      "운동 기록 파일에 같은 항목이 중복돼 있어요. 삼성헬스에서 다시 다운로드한 ZIP을 선택해 주세요.",
    );
  const indices = new Map(
    keys.map((key) => [
      key,
      header.flatMap((h, i) => (h === key || h === prefix + key ? [i] : [])),
    ]),
  );
  if (
    !indices.get("exercise_type")?.length ||
    !indices.get("start_time")?.length
  )
    throw new Error(
      "이 운동 기록 파일의 형식은 아직 읽을 수 없어요. 삼성헬스에서 다운로드한 원본 ZIP인지 확인해 주세요.",
    );
  if (rows.length > 50000)
    throw new Error(
      "운동 기록이 5만 줄 제한을 넘었어요. 더 작은 내보내기 파일을 선택해 주세요.",
    );
  const sessions: InternalSummary[] = [];
  const uuidIndex = new Map<string, number>();
  const deviceGroups = new Map<string, string>();
  let skipped = 0;
  let conflicts = 0;
  for (const row of rows) {
    if (
      row.length < header.length ||
      row.slice(header.length).some((x) => x.trim() !== "")
    ) {
      skipped++;
      continue;
    }
    const issues: string[] = [];
    const field = (key: (typeof keys)[number]): string => {
      const vals = (indices.get(key) ?? [])
        .map((i) => (row[i] ?? "").trim())
        .filter(Boolean);
      if (new Set(vals).size > 1) {
        issues.push("alias-conflict:" + key);
        return "";
      }
      return vals[0] ?? "";
    };
    if (numeric(field("exercise_type")) !== 1002) continue;
    const startMs = parseUtc(field("start_time"));
    if (startMs === null) {
      skipped++;
      continue;
    }
    const offsetMs = parseOffset(field("time_offset"));
    if (offsetMs === null) issues.push("offset-unknown");
    const reference = field("live_data") || null;
    const device = field("deviceuuid");
    if (device && !deviceGroups.has(device))
      deviceGroups.set(
        device,
        `기기 ${String.fromCharCode(65 + deviceGroups.size)}`,
      );
    const item: InternalSummary = {
      id: "",
      startMs,
      endMs: parseUtc(field("end_time")),
      offsetMs,
      date: localDate(startMs, offsetMs),
      durationMs: numeric(field("duration")),
      distanceM: numeric(field("distance")),
      meanHr: numeric(field("mean_heart_rate"), false),
      maxHr: numeric(field("max_heart_rate"), false),
      meanCadence: numeric(field("mean_cadence"), false),
      reference,
      uuid: field("datauuid") || null,
      updatedMs: parseUtc(field("update_time")),
      status: reference ? "pending" : "missing",
      issues,
      deviceGroup: deviceGroups.get(device) ?? "출처 미상",
    };
    item.quality = qualityIssues(item);
    item.issues.push(
      ...item.quality
        .map((q) => q.code)
        .filter((c) => !item.issues.includes(c)),
    );
    const previous = item.uuid ? (uuidIndex.get(item.uuid) ?? -1) : -1;
    if (previous < 0) {
      if (item.uuid) uuidIndex.set(item.uuid, sessions.length);
      sessions.push(item);
    } else {
      const old = sessions[previous];
      if ((item.updatedMs ?? 0) > (old.updatedMs ?? 0))
        sessions[previous] = item;
      else if (
        JSON.stringify({ ...item, id: "" }) !==
        JSON.stringify({ ...old, id: "" })
      ) {
        old.issues.push("session-conflict");
        conflicts++;
      }
    }
  }
  sessions.sort((a, b) => b.startMs - a.startMs);
  sessions.forEach((s, i) => {
    s.id = "run-" + (i + 1);
  });
  return {
    sessions,
    warnings: [
      ...(skipped
        ? [`${skipped}개 기록은 형식이나 시작 시간이 맞지 않아 읽지 못했어요.`]
        : []),
      ...(conflicts
        ? [`${conflicts}개 중복 기록에 서로 다른 값이 있어요.`]
        : []),
    ],
  };
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
export function distanceSemantics(
  points: Point[],
  total: number | null,
): Detail["distanceSemantics"] {
  const values = points
    .map((p) => p.distance)
    .filter((x): x is number => x !== null);
  if (total === null || total <= 0 || values.length < 2) return "unknown";
  const tolerance = Math.max(5, total * 0.01);
  const interval =
    Math.abs(values.reduce((a, b) => a + b, 0) - total) <= tolerance;
  const cumulative =
    values.every((x, i) => i === 0 || x >= values[i - 1]) &&
    Math.abs(values.at(-1)! - total) <= tolerance;
  return interval === cumulative
    ? "unknown"
    : interval
      ? "interval"
      : "cumulative";
}
export function parseDetail(
  text: string,
  summary: Pick<InternalSummary, "id" | "startMs" | "endMs" | "distanceM">,
): Detail {
  let depth = 0,
    inString = false,
    escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") {
      depth++;
      if (depth > 16)
        throw new Error("측정 파일의 구조가 복잡해 읽기 제한을 넘었어요.");
    } else if (char === "}" || char === "]") depth--;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("시간별 측정 파일을 읽지 못했어요.");
  }
  if (!Array.isArray(raw) || raw.length > 100000)
    throw new Error(
      "시간별 측정 파일의 형식이 맞지 않거나 측정값 개수 제한을 넘었어요.",
    );
  const issues: string[] = [];
  const byTime = new Map<number, Point>();
  const conflicts = new Map<number, Set<keyof Point>>();
  let invalid = 0,
    duplicates = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      invalid++;
      continue;
    }
    const value = item as Record<string, unknown>;
    const epochMs =
      typeof value.start_time === "number" ? value.start_time : null;
    if (
      epochMs === null ||
      !Number.isFinite(epochMs) ||
      epochMs < summary.startMs - 1000 ||
      (summary.endMs !== null && epochMs > summary.endMs + 1000)
    ) {
      invalid++;
      continue;
    }
    const speed = numeric(value.speed);
    const point: Point = {
      epochMs,
      time: Math.max(0, (epochMs - summary.startMs) / 1000),
      hr: numeric(value.heart_rate, false),
      speed,
      pace: speed !== null && speed > 0 ? 1000 / speed : null,
      cadence: numeric(value.cadence),
      distance: numeric(value.distance),
    };
    const old = byTime.get(epochMs);
    if (!old) byTime.set(epochMs, point);
    else {
      duplicates++;
      const bad = conflicts.get(epochMs) ?? new Set<keyof Point>();
      for (const key of ["hr", "speed", "cadence", "distance"] as const) {
        if (bad.has(key)) continue;
        if (old[key] === null) old[key] = point[key];
        else if (point[key] !== null && old[key] !== point[key]) {
          old[key] = null;
          bad.add(key);
        }
      }
      old.pace = old.speed !== null && old.speed > 0 ? 1000 / old.speed : null;
      conflicts.set(epochMs, bad);
    }
  }
  const points = [...byTime.values()].sort((a, b) => a.epochMs - b.epochMs);
  if (!points.length)
    throw new Error("이 러닝 시간에 해당하는 측정값을 찾지 못했어요.");
  const intervals = points
    .slice(1)
    .map((p, i) => p.time - points[i].time)
    .filter((n) => n > 0);
  // A sparse export must not bridge minute-long holes as continuous observations.
  const gapSec = Math.min(60, Math.max(3, (median(intervals) ?? 10) * 3));
  if (invalid) issues.push(`invalid-points:${invalid}`);
  if (duplicates) issues.push(`duplicate-points:${duplicates}`);
  if ([...conflicts.values()].some((x) => x.size))
    issues.push("conflicting-points");
  return {
    id: summary.id,
    points,
    gapSec,
    distanceSemantics: distanceSemantics(points, summary.distanceM),
    issues,
  };
}
