import { Decoder, Stream } from "@garmin/fitsdk";
import { SaxesParser } from "saxes";
import { localDate, median, numeric, parseOffset, parseUtc } from "./parser";
import { qualityIssues } from "./quality";
import type { Detail, InternalSummary, Point, QualityIssue } from "./types";

export type ActivityFormat = "gpx" | "tcx" | "fit";
export type ActivitySource = "strava" | "activity";
export const ACTIVITY_LIMITS = {
  bytes: 128 * 1024 ** 2,
  points: 200000,
  sessions: 5000,
  token: 1024 ** 2,
};
export interface ParsedActivity {
  sessions: InternalSummary[];
  details: Detail[];
  warnings: string[];
}
interface RawPoint {
  epochMs: number | null;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
  distance: number | null;
  segment: number;
}
interface RawSession {
  sport: string;
  start: string | number | null;
  end: number | null;
  offset: number | null;
  duration: number | null;
  distance: number | null;
  hr: number | null;
  maxHr: number | null;
  cadence: number | null;
  points: RawPoint[];
  issues: string[];
}
const badFile = () =>
  new Error(
    "운동 파일의 형식을 읽을 수 없어요. 원본 GPX·TCX·FIT 파일을 선택해 주세요.",
  );
const number = (value: unknown, positive = false) => numeric(value, !positive);
function timestamp(value: unknown) {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  return parseUtc(value);
}
function xmlTime(value: string) {
  // GPX/TCX timestamps require a timezone; an unqualified date is ambiguous.
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}:?\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const local = parseUtc(`${match[1]} ${match[2]}`);
  const offset = match[3] === "Z" ? 0 : parseOffset(match[3]);
  return local === null || offset === null ? null : local - offset;
}
function xmlOffset(value: string) {
  // Z identifies the instant in UTC, but does not identify the runner's local date.
  const m = /([+-]\d{2}:?\d{2})$/.exec(value);
  return m ? parseOffset(m[1]) : null;
}
const rawPoint = (segment: number): RawPoint => ({
  epochMs: null,
  hr: null,
  speed: null,
  cadence: null,
  distance: null,
  segment,
});
const rawSession = (sport = ""): RawSession => ({
  sport,
  start: null,
  end: null,
  offset: null,
  duration: null,
  distance: null,
  hr: null,
  maxHr: null,
  cadence: null,
  points: [],
  issues: [],
});
function running(
  sport: string,
  format: ActivityFormat,
  source: ActivitySource,
) {
  const key = sport.toLowerCase().replace(/[\s_-]/g, "");
  if (
    [
      "run",
      "running",
      "trailrun",
      "trailrunning",
      "treadmill",
      "virtualrun",
    ].includes(key)
  )
    return true;
  if (format === "gpx" && source === "strava" && key === "9") return true;
  return format === "gpx" && !key;
}

function parseXml(text: string, format: "gpx" | "tcx"): RawSession[] {
  const parser = new SaxesParser({ xmlns: false });
  const stack: { name: string; text: string }[] = [];
  const sessions: RawSession[] = [];
  let current: RawSession | null = null,
    point: RawPoint | null = null,
    segment = 0,
    totalPoints = 0,
    seenRoot = false,
    stravaGpx = false,
    sessionDepth = 0;
  let lap: {
    duration: number | null;
    distance: number | null;
    hr: number | null;
    maxHr: number | null;
  } | null = null;
  let lapCount = 0,
    durationComplete = true,
    distanceComplete = true,
    hrWeight = 0,
    hrSum = 0;
  let boundary = 0;
  const markBoundary = () => {
    if (parser.position - boundary > ACTIVITY_LIMITS.token)
      throw new Error("XML 항목의 크기 제한을 넘었어요.");
    boundary = parser.position;
  };
  parser.on("error", () => {
    throw badFile();
  });
  parser.on("doctype", () => {
    throw badFile();
  });
  parser.on("opentag", (tag) => {
    markBoundary();
    const name = tag.name.split(":").at(-1)!;
    if (!stack.length) {
      if (
        seenRoot ||
        name !== (format === "gpx" ? "gpx" : "TrainingCenterDatabase")
      )
        throw badFile();
      seenRoot = true;
      stravaGpx =
        format === "gpx" &&
        /strava/i.test(String(tag.attributes.creator ?? ""));
    }
    if (stack.length >= 32 || Object.keys(tag.attributes).length > 64)
      throw badFile();
    stack.push({ name, text: "" });
    if (
      (format === "gpx" && name === "trk" && stack.length === 2) ||
      (format === "tcx" &&
        name === "Activity" &&
        stack.some((s) => s.name === "Activities"))
    ) {
      if (current || sessions.length >= ACTIVITY_LIMITS.sessions)
        throw badFile();
      current = rawSession(
        format === "tcx" ? String(tag.attributes.Sport ?? "") : "",
      );
      sessionDepth = stack.length;
      segment = 0;
      lapCount = 0;
      durationComplete = distanceComplete = true;
      hrWeight = hrSum = 0;
    }
    if (!current) return;
    if (
      (format === "gpx" && name === "trkseg") ||
      (format === "tcx" && name === "Track")
    )
      segment++;
    if (
      (format === "gpx" && name === "trkpt") ||
      (format === "tcx" && name === "Trackpoint")
    ) {
      if (point || ++totalPoints > ACTIVITY_LIMITS.points)
        throw new Error("한 파일의 측정값이 20만 개 제한을 넘었어요.");
      point = rawPoint(segment);
    }
    if (format === "tcx" && name === "Lap") {
      if (lap) throw badFile();
      lap = { duration: null, distance: null, hr: null, maxHr: null };
      const start = String(tag.attributes.StartTime ?? "");
      if (current.start === null && xmlTime(start) !== null) {
        current.start = start;
        current.offset = xmlOffset(start);
      }
    }
  });
  const onText = (value: string) => {
    markBoundary();
    const node = stack.at(-1);
    if (
      value.length > ACTIVITY_LIMITS.token ||
      (node && node.text.length + value.length > ACTIVITY_LIMITS.token)
    )
      throw new Error("XML 항목의 크기 제한을 넘었어요.");
    if (node) node.text += value;
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", () => {
    markBoundary();
    const node = stack.at(-1)!,
      parent = stack.at(-2)?.name;
    const value = node.text.trim(),
      name = node.name;
    if (current) {
      if (point) {
        if (name === "time" || name === "Time") {
          point.epochMs = xmlTime(value);
          if (
            format === "gpx" &&
            current.start === null &&
            point.epochMs !== null
          ) {
            current.start = value;
            current.offset = xmlOffset(value);
          }
        } else if (
          name === "hr" ||
          (name === "Value" && parent === "HeartRateBpm")
        )
          point.hr = number(value, true);
        else if (name === "speed" || name === "Speed")
          point.speed = number(value);
        else if (name === "distance" || name === "DistanceMeters")
          point.distance = number(value);
        // Garmin cadence is cycles/strides per minute. Running has two steps per cycle.
        else if (name === "cad" || name === "RunCadence") {
          const cadence = number(value);
          point.cadence = cadence === null ? null : cadence * 2;
        }
        if (name === "trkpt" || name === "Trackpoint") {
          current.points.push(point);
          point = null;
        }
      } else if (
        format === "gpx" &&
        stack.length === sessionDepth + 1 &&
        name === "type"
      ) {
        current.sport = stravaGpx && value === "9" ? "running" : value;
      } else if (format === "tcx") {
        if (
          name === "Id" &&
          stack.length === sessionDepth + 1 &&
          xmlTime(value) !== null
        ) {
          current.start = value;
          current.offset = xmlOffset(value);
        }
        if (lap) {
          if (name === "TotalTimeSeconds" && parent === "Lap")
            lap.duration = number(value);
          else if (name === "DistanceMeters" && parent === "Lap")
            lap.distance = number(value);
          else if (name === "Value" && parent === "AverageHeartRateBpm")
            lap.hr = number(value, true);
          else if (name === "Value" && parent === "MaximumHeartRateBpm")
            lap.maxHr = number(value, true);
          else if (name === "Lap") {
            lapCount++;
            durationComplete &&= lap.duration !== null;
            distanceComplete &&= lap.distance !== null;
            current.duration =
              (current.duration ?? 0) + (lap.duration ?? 0) * 1000;
            current.distance = (current.distance ?? 0) + (lap.distance ?? 0);
            if (lap.hr !== null && lap.duration !== null) {
              hrSum += lap.hr * lap.duration;
              hrWeight += lap.duration;
            }
            if (lap.maxHr !== null)
              current.maxHr = Math.max(current.maxHr ?? 0, lap.maxHr);
            lap = null;
          }
        }
      }
      if (
        stack.length === sessionDepth &&
        (name === "trk" || name === "Activity")
      ) {
        if (format === "tcx") {
          if (!lapCount || !durationComplete) current.duration = null;
          if (!lapCount || !distanceComplete) current.distance = null;
          if (
            hrWeight > 0 &&
            current.duration !== null &&
            Math.abs(hrWeight * 1000 - current.duration) < 1
          )
            current.hr = hrSum / hrWeight;
        }
        sessions.push(current);
        current = null;
      }
    }
    stack.pop();
  });
  // Chunk writes bound unfinished attributes and DTDs as well as completed text.
  parser.on("comment", markBoundary);
  parser.on("processinginstruction", markBoundary);
  for (let i = 0; i < text.length; i += 16384) {
    parser.write(text.slice(i, i + 16384));
    // Saxes has separate unfinished-token buffers; size is bounded by this check.
    if (parser.position - boundary > ACTIVITY_LIMITS.token)
      throw new Error("XML 항목의 크기 제한을 넘었어요.");
  }
  parser.close();
  if (!seenRoot || current || point) throw badFile();
  return sessions;
}

type Row = Record<string, unknown>;
function parseFit(data: Uint8Array): RawSession[] {
  const decoder = new Decoder(Stream.fromByteArray(data));
  if (!decoder.isFIT() || !decoder.checkIntegrity()) throw badFile();
  let messageCount = 0;
  const { messages, errors } = decoder.read({
    includeUnknownData: false,
    decodeMemoGlobs: false,
    mergeHeartRates: false,
    mesgListener: () => {
      if (++messageCount > ACTIVITY_LIMITS.points * 3)
        throw new Error("FIT 측정값 개수 제한을 넘었어요.");
    },
  });
  if (errors.length) throw badFile();
  const records = (messages.recordMesgs ?? []) as Row[];
  const rows = (messages.sessionMesgs ?? []) as Row[];
  if (
    records.length > ACTIVITY_LIMITS.points ||
    rows.length > ACTIVITY_LIMITS.sessions
  )
    throw badFile();
  if (!rows.length) {
    const sport = messages.sportMesgs?.[0]?.sport;
    if (sport === "running")
      rows.push({
        sport,
        startTime: records[0]?.timestamp,
        timestamp: records.at(-1)?.timestamp,
      });
  }
  const events = (messages.eventMesgs ?? []) as Row[];
  const localTimes = (messages.activityMesgs ?? []).flatMap((a) => {
    const utc = timestamp(a.timestamp),
      local = number(a.localTimestamp);
    if (utc === null || local === null || local < 0x10000000) return [];
    const offset = local * 1000 + 631065600000 - utc;
    return Math.abs(offset) <= 14 * 3600000 && offset % 60000 === 0
      ? [{ utc, offset }]
      : [];
  });
  return rows.map((row) => {
    const out = rawSession(String(row.sport ?? ""));
    out.start = timestamp(row.startTime);
    out.end = timestamp(row.timestamp);
    const elapsed = number(row.totalElapsedTime);
    if (out.start !== null && out.end === null && elapsed !== null)
      out.end = Number(out.start) + elapsed * 1000;
    const localTime = localTimes.find(
      (t) => out.end !== null && Math.abs(t.utc - out.end) <= 1000,
    );
    if (localTime) out.offset = localTime.offset;
    const timer = number(row.totalTimerTime);
    out.duration = timer === null ? null : timer * 1000;
    out.distance = number(row.totalDistance);
    out.hr = number(row.avgHeartRate, true);
    out.maxHr = number(row.maxHeartRate, true);
    const cad = number(row.avgRunningCadence) ?? number(row.avgCadence);
    out.cadence =
      cad === null ? null : (cad + (number(row.avgFractionalCadence) ?? 0)) * 2;
    const start = Number(out.start),
      end = out.end ?? Infinity;
    const timerEvents = events
      .filter((e) => e.event === "timer" && timestamp(e.timestamp) !== null)
      .map((e) => ({
        time: timestamp(e.timestamp)!,
        type: String(e.eventType),
      }))
      .filter((e) => e.time >= start && e.time <= end)
      .sort((a, b) => a.time - b.time);
    const pauses: { from: number; to: number }[] = [];
    let paused: number | null = null;
    for (const event of timerEvents) {
      if (
        ["stop", "stopAll", "stopDisable", "stopDisableAll"].includes(
          event.type,
        ) &&
        paused === null
      )
        paused = event.time;
      else if (event.type === "start" && paused !== null) {
        pauses.push({ from: paused, to: event.time });
        paused = null;
      }
    }
    if (paused !== null && paused < end && Number.isFinite(end))
      pauses.push({ from: paused, to: end });
    for (const r of records) {
      const epochMs = timestamp(r.timestamp);
      if (epochMs === null || epochMs < start || epochMs > end) continue;
      const cadence = number(r.cadence);
      const p: RawPoint = {
        epochMs,
        hr: number(r.heartRate, true),
        speed: number(r.enhancedSpeed) ?? number(r.speed),
        distance: number(r.distance),
        cadence:
          cadence === null
            ? null
            : (cadence + (number(r.fractionalCadence) ?? 0)) * 2,
        segment: pauses.filter((pause) => pause.to <= epochMs).length,
      };
      if (pauses.some((pause) => epochMs > pause.from && epochMs < pause.to)) {
        p.hr = p.speed = p.cadence = null;
        p.segment = -1;
      }
      out.points.push(p);
    }
    for (const pause of pauses) {
      out.points.push({ ...rawPoint(-1), epochMs: pause.from });
      out.points.push({ ...rawPoint(-1), epochMs: pause.to });
    }
    return out;
  });
}

function normalize(
  raw: RawSession,
  format: ActivityFormat,
  source: ActivitySource,
  id: string,
) {
  const valid = raw.points.filter(
    (p): p is RawPoint & { epochMs: number } => p.epochMs !== null,
  );
  valid.sort((a, b) => a.epochMs - b.epochMs);
  const startMs =
    typeof raw.start === "string"
      ? xmlTime(raw.start)
      : (timestamp(raw.start) ?? valid[0]?.epochMs ?? null);
  if (startMs === null) return null;
  const points: Point[] = [];
  const issues = [...raw.issues];
  if (raw.points.length > valid.length)
    issues.push(`invalid-points:${raw.points.length - valid.length}`);
  const endMs = raw.end ?? valid.at(-1)?.epochMs ?? null;
  const intervals = valid
    .slice(1)
    .map((p, i) => p.epochMs - valid[i].epochMs)
    .filter((v) => v > 0);
  const gapSec = Math.min(
    30,
    Math.max(3, (median(intervals) ?? 10000) * 0.003),
  );
  const byTime = new Map<number, RawPoint & { epochMs: number }>();
  const conflicts = new Map<number, Set<keyof RawPoint>>();
  let duplicateConflict = false;
  for (const p of valid) {
    if (p.epochMs < startMs || (endMs !== null && p.epochMs > endMs)) continue;
    const old = byTime.get(p.epochMs);
    if (!old) byTime.set(p.epochMs, { ...p });
    else if (p.segment === -1 || old.segment === -1) {
      old.hr = old.speed = old.cadence = old.distance = null;
      old.segment = -1;
    } else {
      const bad = conflicts.get(p.epochMs) ?? new Set<keyof RawPoint>();
      for (const key of ["hr", "speed", "cadence", "distance"] as const) {
        if (bad.has(key)) continue;
        if (old[key] !== null && p[key] !== null && old[key] !== p[key]) {
          old[key] = null;
          bad.add(key);
          duplicateConflict = true;
        } else if (old[key] === null) old[key] = p[key];
      }
      conflicts.set(p.epochMs, bad);
    }
  }
  if (duplicateConflict) issues.push("conflicting-points");
  const rows = [...byTime.values()];
  let derived = false,
    segmented = false;
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i],
      next = rows[i + 1],
      previous = rows[i - 1];
    let speed = p.speed;
    // Distance/time is an average over an explicitly observed cumulative-distance
    // interval. Never compute a distance from coordinates or bridge a pause/gap.
    if (
      speed === null &&
      next &&
      p.segment >= 0 &&
      p.segment === next.segment &&
      p.distance !== null &&
      next.distance !== null &&
      next.distance >= p.distance &&
      next.epochMs > p.epochMs &&
      next.epochMs - p.epochMs <= gapSec * 1000
    ) {
      speed =
        (next.distance - p.distance) / ((next.epochMs - p.epochMs) / 1000);
      derived = true;
    }
    // Preserve the observed interval's ending boundary, without extending it
    // into the following gap. Consumers require both endpoints to be present.
    if (
      speed === null &&
      previous &&
      p.segment >= 0 &&
      previous.segment === p.segment &&
      previous.distance !== null &&
      p.distance !== null &&
      p.distance >= previous.distance &&
      p.epochMs > previous.epochMs &&
      p.epochMs - previous.epochMs <= gapSec * 1000
    ) {
      speed =
        (p.distance - previous.distance) /
        ((p.epochMs - previous.epochMs) / 1000);
      derived = true;
    }
    points.push({
      epochMs: p.epochMs,
      time: (p.epochMs - startMs) / 1000,
      hr: p.hr,
      speed,
      pace: speed !== null && speed > 0 ? 1000 / speed : null,
      cadence: p.cadence,
      distance: p.distance,
    });
    if (next && p.segment !== next.segment && p.epochMs < next.epochMs) {
      segmented = true;
      const epochMs = (p.epochMs + next.epochMs) / 2;
      points.push({
        epochMs,
        time: (epochMs - startMs) / 1000,
        hr: null,
        speed: null,
        pace: null,
        cadence: null,
        distance: null,
      });
    }
  }
  if (derived) issues.push("activity-distance-speed");
  if (!points.some((p) => p.speed !== null))
    issues.push("activity-speed-unavailable");
  if (segmented) issues.push("activity-segment-break");
  if (!raw.sport && format === "gpx") issues.push("activity-type-unknown");
  let durationMs = raw.duration;
  if (format === "gpx" || durationMs === null) {
    durationMs = endMs !== null ? endMs - startMs : null;
    if (durationMs !== null) issues.push("activity-elapsed-time");
  }
  let distanceM = raw.distance;
  const distances = rows.map((p) => p.distance);
  if (
    distanceM === null &&
    distances.length >= 2 &&
    distances[0] === 0 &&
    distances.every((d, i) => d !== null && (i === 0 || d >= distances[i - 1]!))
  )
    distanceM = distances.at(-1)!;
  const detail: Detail = {
    id,
    points,
    gapSec,
    distanceSemantics: "cumulative",
    issues: [...issues],
  };
  const summary: InternalSummary = {
    id,
    source,
    startMs,
    endMs,
    offsetMs: raw.offset,
    date: localDate(startMs, raw.offset),
    durationMs,
    distanceM,
    meanHr: raw.hr,
    maxHr: raw.maxHr,
    meanCadence: raw.cadence,
    status: points.length > 1 ? "ready" : "limited",
    detailAvailable: points.length > 1,
    issues,
    reference: null,
    uuid: null,
    updatedMs: null,
    deviceGroup: "출처 미상",
  };
  if (raw.offset === null) issues.push("offset-unknown");
  if (points.length < 2) issues.push("activity-summary-only");
  const notices: Record<string, string> = {
    "activity-elapsed-time":
      "파일에 운동 중인 시간이 없어 시작·종료 사이 경과시간을 표시해요. 일시정지 시간이 포함될 수 있어요.",
    "activity-distance-speed":
      "일부 속도는 파일의 누적 거리와 시각 차이로 구한 구간 평균이에요. GPS 좌표로 거리를 만들거나 측정이 끊긴 구간을 채우지 않아요.",
    "activity-type-unknown":
      "이 GPX에 운동 종류가 없어 러닝 파일로 불러왔어요. 러닝 기록인지 확인해 주세요.",
    "activity-summary-only":
      "이 파일에는 시간별 측정이 없어 요약 기록만 보여드려요.",
    "activity-segment-break":
      "원본의 트랙 분리·일시정지 경계를 측정이 끊긴 구간으로 보존했어요.",
    "activity-speed-unavailable":
      "파일에 속도·누적 거리 측정이 없어 상세 페이스를 표시할 수 없어요. GPS 좌표로 값을 만들지 않아요.",
  };
  summary.quality = [
    ...qualityIssues(summary, detail),
    ...issues.flatMap((code): QualityIssue[] =>
      notices[code]
        ? [
            {
              code,
              evidence: notices[code],
              metrics: ["detail"],
              action: "notice",
            },
          ]
        : [],
    ),
  ];
  for (const q of summary.quality)
    if (!summary.issues.includes(q.code)) summary.issues.push(q.code);
  return { summary, detail: points.length > 1 ? detail : null };
}

/** Normalizes local activity exports. Names, IDs, device metadata and positions never survive parsing. */
export function parseActivity(
  data: Uint8Array | string,
  format: ActivityFormat,
  source: ActivitySource = "activity",
): ParsedActivity {
  if (
    (typeof data === "string" ? data.length : data.byteLength) >
    ACTIVITY_LIMITS.bytes
  )
    throw new Error("운동 파일이 128MB 제한을 넘었어요.");
  let raw: RawSession[];
  if (format === "fit") {
    if (typeof data === "string") throw badFile();
    raw = parseFit(data);
  } else {
    let text: string;
    try {
      text =
        typeof data === "string"
          ? data
          : new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw badFile();
    }
    raw = parseXml(text.replace(/^\uFEFF/, ""), format);
  }
  const sessions: InternalSummary[] = [],
    details: Detail[] = [];
  let skipped = 0;
  for (const r of raw) {
    if (!running(r.sport, format, source)) {
      skipped++;
      continue;
    }
    const result = normalize(
      r,
      format,
      source,
      `activity-${sessions.length + 1}`,
    );
    if (!result) {
      skipped++;
      continue;
    }
    sessions.push(result.summary);
    if (result.detail) details.push(result.detail);
  }
  return {
    sessions,
    details,
    warnings: skipped
      ? [`${skipped}개 항목은 러닝이 아니거나 시작 시각이 없어 건너뛰었어요.`]
      : [],
  };
}
