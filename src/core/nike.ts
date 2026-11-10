import { localDate, median, numeric, parseOffset } from "./parser";
import { qualityIssues } from "./quality";
import type { Detail, InternalSummary, Point } from "./types";

export const NIKE_LIMITS = {
  json: 64 * 1024 ** 2,
  runs: 50000,
  values: 1000000,
};

type Row = Record<string, unknown>;
type Channel = "hr" | "speed" | "cadence";
type Sample = { from: number; to: number; value: number };
const row = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
const label = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
const epoch = (value: unknown) => {
  const n = numeric(value, false);
  return n !== null && n <= 8640000000000000 ? n : null;
};
const startOf = (a: Row) => epoch(a.start_epoch_ms ?? a.startEpochMs);
const endOf = (a: Row) => epoch(a.end_epoch_ms ?? a.endEpochMs);
const isRun = (a: Row) => ["run", "jogging"].includes(label(a.type));
const isActivity = (a: Row) =>
  typeof a.type === "string" &&
  ("start_epoch_ms" in a || "startEpochMs" in a) &&
  (Array.isArray(a.summaries) || Array.isArray(a.metrics));

function activities(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = row(value);
  return object && Array.isArray(object.activities)
    ? object.activities
    : object
      ? [object]
      : [];
}

// Nike does not publish a stable privacy-export JSON schema. Recognize only
// the explicit activity / metric representation, never arbitrary profile JSON.
export function sniffNike(value: unknown): boolean {
  return activities(value).some((value) => {
    const a = row(value);
    return a !== null && isActivity(a);
  });
}

function quantity(
  value: unknown,
  unitValue: unknown,
  kind: Channel | "distance",
) {
  const unit = label(unitValue).replace(/\s+/g, "");
  const factors: Record<string, number> =
    kind === "distance"
      ? { m: 1, meter: 1, meters: 1, km: 1000, mi: 1609.344 }
      : kind === "hr"
        ? { bpm: 1, "beats/min": 1, "count/min": 1 }
        : kind === "cadence"
          ? { spm: 1, "steps/min": 1, "count/min": 1 }
          : {
              "m/s": 1,
              mps: 1,
              "km/h": 1 / 3.6,
              "km/hr": 1 / 3.6,
              kmh: 1 / 3.6,
              kph: 1 / 3.6,
              mph: 0.44704,
            };
  const n = numeric(value, kind !== "hr");
  const factor = factors[unit];
  if (n === null || factor === undefined) return null;
  const converted = n * factor;
  return Number.isFinite(converted) ? converted : null;
}

function offsetOf(a: Row, startMs: number): number | null {
  const explicit = parseOffset(a.utc_offset ?? a.utcOffset);
  if (explicit !== null) return explicit;
  // An IANA zone is explicit timezone information; do not use this computer's
  // zone or infer an undocumented numeric timezone-offset unit.
  const zone = a.time_zone ?? a.timeZone;
  if (typeof zone !== "string" || zone.length > 100) return null;
  if (["utc", "etc/utc", "gmt"].includes(zone.toLowerCase())) return 0;
  try {
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(startMs)
      .find((part) => part.type === "timeZoneName")?.value;
    if (offset === "GMT") return 0;
    return offset ? parseOffset(offset.replace(/^GMT/, "")) : null;
  } catch {
    return null;
  }
}

function makeDetail(
  a: Row,
  id: string,
  startMs: number,
  endMs: number | null,
  issue: (code: string) => void,
  countValue: () => void,
): Detail | null {
  const channels: Record<Channel, Sample[]> = {
    hr: [],
    speed: [],
    cadence: [],
  };
  for (const rawMetric of Array.isArray(a.metrics) ? a.metrics : []) {
    const metric = row(rawMetric);
    if (!metric || !Array.isArray(metric.values)) continue;
    const kind: Channel | null =
      label(metric.type) === "heart_rate"
        ? "hr"
        : label(metric.type) === "speed"
          ? "speed"
          : label(metric.type) === "cadence"
            ? "cadence"
            : null;
    for (const rawValue of metric.values) {
      countValue();
      if (!kind) continue;
      const value = row(rawValue);
      if (!value) {
        issue("nike-invalid-values");
        continue;
      }
      const from = startOf(value),
        to = endOf(value),
        n = quantity(value.value, metric.unit, kind);
      if (n === null) {
        issue("nike-unit-or-value-unknown");
        continue;
      }
      if (
        from === null ||
        to === null ||
        from < startMs ||
        to <= from ||
        (endMs !== null && to > endMs)
      ) {
        issue("nike-invalid-values");
        continue;
      }
      channels[kind].push({ from, to, value: n });
    }
  }
  const boundaries = new Set<number>();
  for (const kind of ["hr", "speed", "cadence"] as const) {
    channels[kind].sort((a, b) => a.from - b.from || a.to - b.to);
    for (const value of channels[kind]) {
      boundaries.add(value.from);
      boundaries.add(value.to);
    }
  }
  const times = [...boundaries].sort((a, b) => a - b);
  if (times.length < 2) return null;
  const pointers = { hr: 0, speed: 0, cadence: 0 };
  const active: Record<Channel, Sample[]> = { hr: [], speed: [], cadence: [] };
  const points: Point[] = [];
  let hasValues = false;
  for (let i = 0; i < times.length - 1; i++) {
    const from = times[i],
      to = times[i + 1];
    const values: Record<Channel, number | null> = {
      hr: null,
      speed: null,
      cadence: null,
    };
    for (const kind of ["hr", "speed", "cadence"] as const) {
      active[kind] = active[kind].filter((sample) => sample.to > from);
      while (channels[kind][pointers[kind]]?.from <= from)
        active[kind].push(channels[kind][pointers[kind]++]);
      if (active[kind].length > 1000)
        throw new Error(
          "나이키 측정 구간이 지나치게 많이 겹쳐 읽을 수 없어요.",
        );
      const distinct = new Set(active[kind].map((sample) => sample.value));
      if (distinct.size === 1) values[kind] = active[kind][0].value;
      else if (distinct.size > 1) issue("conflicting-points");
    }
    hasValues ||= Object.values(values).some((n) => n !== null);
    // Preserve explicit interval boundaries. A zero-duration pair at a change
    // to / from null prevents the common point model from bridging a gap or
    // losing the last observed interval. It adds no observed time.
    for (const epochMs of [from, to]) {
      const p: Point = {
        epochMs,
        time: (epochMs - startMs) / 1000,
        hr: values.hr,
        speed: values.speed,
        pace:
          values.speed !== null && values.speed > 0
            ? 1000 / values.speed
            : null,
        cadence: values.cadence,
        distance: null,
      };
      const previous = points.at(-1);
      if (
        previous?.epochMs === epochMs &&
        previous.hr === p.hr &&
        previous.speed === p.speed &&
        previous.cadence === p.cadence
      )
        continue;
      points.push(p);
      if (points.length > NIKE_LIMITS.values)
        throw new Error("나이키 측정값이 100만 개 제한을 넘었어요.");
    }
  }
  if (!hasValues) return null;
  const intervals = Object.values(channels).flatMap((samples) =>
    samples.map((sample) => (sample.to - sample.from) / 1000),
  );
  return {
    id,
    points,
    gapSec: Math.min(60, Math.max(3, (median(intervals) ?? 10) * 3)),
    distanceSemantics: "unknown",
    issues: [],
  };
}

export function parseNike(text: string): {
  sessions: InternalSummary[];
  details: Detail[];
  warnings: string[];
} {
  if (text.length > NIKE_LIMITS.json)
    throw new Error("나이키 JSON 파일이 64MB 제한을 넘었어요.");
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "나이키 JSON 형식을 읽을 수 없어요. 원본 내보내기 파일인지 확인해 주세요.",
    );
  }
  if (!sniffNike(json))
    throw new Error(
      "지원하는 나이키 활동 JSON이 아니에요. GPX·TCX 또는 활동의 metrics·summaries가 포함된 JSON을 선택해 주세요.",
    );
  const raw = activities(json);
  if (raw.length > NIKE_LIMITS.runs)
    throw new Error("러닝 기록이 5만 개 제한을 넘었어요.");
  const result: { session: InternalSummary; detail: Detail | null }[] = [];
  const signatures = new Set<string>();
  let skipped = 0,
    duplicates = 0,
    totalValues = 0;
  for (const value of raw) {
    const a = row(value);
    if (!a || !isActivity(a) || !isRun(a)) continue;
    const startMs = startOf(a),
      endMs = endOf(a);
    if (startMs === null || (endMs !== null && endMs < startMs)) {
      skipped++;
      continue;
    }
    const issues: string[] = [];
    const issue = (code: string) => {
      if (!issues.includes(code)) issues.push(code);
    };
    const summaryValue = (
      kind: "distance" | "hr" | "cadence",
      summaries: string[],
    ): number | null => {
      const values: number[] = [];
      for (const rawSummary of Array.isArray(a.summaries) ? a.summaries : []) {
        const s = row(rawSummary);
        if (
          !s ||
          label(s.metric) !== (kind === "hr" ? "heart_rate" : kind) ||
          !summaries.includes(label(s.summary))
        )
          continue;
        const n = quantity(s.value, s.unit, kind);
        if (n !== null) values.push(n);
        else issue("nike-unit-or-value-unknown");
      }
      if (new Set(values).size > 1) {
        issue("nike-summary-conflict");
        return null;
      }
      return values[0] ?? null;
    };
    const distanceM = summaryValue("distance", ["", "sum", "total"]),
      meanHr = summaryValue("hr", ["", "mean", "average"]),
      maxHr = summaryValue("hr", ["max", "maximum"]),
      meanCadence = summaryValue("cadence", ["", "mean", "average"]);
    const durationMs =
      numeric(a.active_duration_ms ?? a.activeDurationMs) ??
      numeric(a.duration_ms ?? a.durationMs) ??
      (endMs !== null ? endMs - startMs : null);
    const offsetMs = offsetOf(a, startMs);
    if (offsetMs === null) issue("offset-unknown");
    const id = `nike-${result.length + 1}`;
    const detail = makeDetail(a, id, startMs, endMs, issue, () => {
      if (++totalValues > NIKE_LIMITS.values)
        throw new Error("나이키 측정값이 100만 개 제한을 넘었어요.");
    });
    if (!detail) issue("summary-only");
    const session: InternalSummary = {
      id,
      source: "nike",
      startMs,
      endMs,
      offsetMs,
      date: localDate(startMs, offsetMs),
      durationMs,
      distanceM,
      meanHr,
      maxHr,
      meanCadence,
      status: detail ? "pending" : "missing",
      detailAvailable: detail !== null,
      issues,
      reference: null,
      uuid: null,
      updatedMs: null,
      deviceGroup: "출처 미상",
    };
    if (detail)
      detail.issues = issues.filter((code) => !code.startsWith("offset-"));
    session.quality = qualityIssues(session, detail ?? undefined);
    // Only a byte-equivalent recognized activity is safely a duplicate. Do not
    // collapse two devices merely because their start / distance agree.
    const signature = JSON.stringify(a);
    if (signatures.has(signature)) {
      duplicates++;
      continue;
    }
    signatures.add(signature);
    result.push({ session, detail });
  }
  if (!result.length)
    throw new Error("나이키 파일에서 읽을 수 있는 러닝 기록을 찾지 못했어요.");
  result.sort((a, b) => b.session.startMs - a.session.startMs);
  result.forEach(({ session, detail }, i) => {
    session.id = `nike-${i + 1}`;
    if (detail) detail.id = session.id;
  });
  return {
    sessions: result.map((run) => run.session),
    details: result.flatMap((run) => (run.detail ? [run.detail] : [])),
    warnings: [
      ...(skipped
        ? [`시작·종료 시각이 잘못된 나이키 러닝 ${skipped}개를 읽지 못했어요.`]
        : []),
      ...(duplicates
        ? [`내용이 같은 나이키 러닝 ${duplicates}개를 한 번만 읽었어요.`]
        : []),
      ...(result.some(({ session }) =>
        session.issues.includes("nike-unit-or-value-unknown"),
      )
        ? [
            "단위가 없거나 지원하지 않는 나이키 측정값은 추정하지 않고 비워 두었어요.",
          ]
        : []),
      ...(result.some(({ session }) =>
        session.issues.includes("nike-invalid-values"),
      )
        ? ["시각이나 측정 구간이 잘못된 나이키 측정값은 계산에서 제외했어요."]
        : []),
      ...(result.some(({ session }) =>
        session.issues.includes("nike-summary-conflict"),
      )
        ? ["서로 다른 요약값이 있는 나이키 항목은 비워 두었어요."]
        : []),
      ...(result.some(({ session }) =>
        session.issues.includes("conflicting-points"),
      )
        ? ["서로 다른 나이키 측정값이 겹친 구간은 계산에서 제외했어요."]
        : []),
      ...(result.some(({ session }) => !session.detailAvailable)
        ? ["시간별 심박·속도가 없는 나이키 기록은 운동 요약만 볼 수 있어요."]
        : []),
    ],
  };
}
