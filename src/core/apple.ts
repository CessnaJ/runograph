import { SaxesParser } from "saxes";
import { localDate, numeric, parseOffset, parseUtc } from "./parser";
import { qualityIssues } from "./quality";
import type { InternalSummary } from "./types";

export const APPLE_LIMITS = { xml: 1024 ** 3, runs: 50000, token: 1024 ** 2 };
const invalidXml = () =>
  new Error(
    "애플 건강 XML 형식을 읽을 수 없어요. 원본 내보내기 파일인지 확인해 주세요.",
  );

export function appleDate(value: string | undefined) {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([+-]\d{4})$/.exec(
      value ?? "",
    );
  if (!match) return null;
  const local = parseUtc(`${match[1]} ${match[2]}`);
  const offsetMs = parseOffset(match[3]);
  if (local === null || offsetMs === null) return null;
  return { ms: local - offsetMs, offsetMs };
}

function quantity(
  value: string | undefined,
  unit: string | undefined,
  kind: "distance" | "duration" | "hr",
) {
  const units: Record<string, number> =
    kind === "distance"
      ? { m: 1, km: 1000, mi: 1609.344, ft: 0.3048, yd: 0.9144 }
      : kind === "duration"
        ? { s: 1000, min: 60000, hr: 3600000 }
        : { "count/min": 1, "count/s": 60 };
  const n = numeric(value, kind !== "hr");
  const factor = unit ? units[unit] : undefined;
  return n === null || factor === undefined || !Number.isFinite(n * factor)
    ? null
    : n * factor;
}

type Attributes = Record<string, string>;
type Workout = { attributes: Attributes; stats: Attributes[] };

// Only Workout summaries survive this streaming pass. Record, Me, metadata,
// source names and device strings are never returned, stored or logged.
export class AppleHealthParser {
  private parser = new SaxesParser({ xmlns: false });
  private stack: string[] = [];
  private workout: Workout | null = null;
  private sessions: InternalSummary[] = [];
  private sources = new Map<string, string>();
  private signatures = new Set<string>();
  private skipped = 0;
  private duplicates = 0;
  private seenRoot = false;
  private written = 0;
  private boundary = 0;

  constructor() {
    const boundary = () => {
      this.boundary = this.parser.position;
    };
    this.parser.on("error", () => {
      throw invalidXml();
    });
    this.parser.on("doctype", (dtd) => {
      boundary();
      // Apple includes an internal DTD. Never resolve entities or external DTDs.
      if (/<!ENTITY|\bSYSTEM\b|\bPUBLIC\b/.test(dtd)) throw invalidXml();
    });
    this.parser.on("text", boundary);
    this.parser.on("cdata", boundary);
    this.parser.on("comment", boundary);
    this.parser.on("opentag", (tag) => {
      boundary();
      if (this.stack.length === 0) {
        if (tag.name !== "HealthData" || this.seenRoot) throw invalidXml();
        this.seenRoot = true;
      }
      if (this.stack.length >= 32 || Object.keys(tag.attributes).length > 64)
        throw invalidXml();
      this.stack.push(tag.name);
      if (
        this.stack.length === 2 &&
        tag.name === "Workout" &&
        tag.attributes.workoutActivityType === "HKWorkoutActivityTypeRunning"
      ) {
        this.workout = { attributes: tag.attributes, stats: [] };
      } else if (
        this.stack.length === 3 &&
        tag.name === "WorkoutStatistics" &&
        this.workout
      ) {
        if (this.workout.stats.length >= 100) throw invalidXml();
        this.workout.stats.push(tag.attributes);
      }
    });
    this.parser.on("closetag", (tag) => {
      boundary();
      if (this.stack.length === 2 && tag.name === "Workout" && this.workout) {
        this.addWorkout(this.workout);
        this.workout = null;
      }
      this.stack.pop();
    });
  }

  write(text: string) {
    // Bound unfinished attribute/text/DTD tokens even across incoming chunks.
    for (let i = 0; i < text.length; i += 16384) {
      const part = text.slice(i, i + 16384);
      this.written += part.length;
      this.parser.write(part);
      if (this.written - this.boundary > APPLE_LIMITS.token)
        throw new Error("XML 항목의 크기 제한을 넘었어요.");
    }
  }

  private addWorkout({ attributes: a, stats }: Workout) {
    if (
      this.sessions.length + this.skipped + this.duplicates >=
      APPLE_LIMITS.runs
    )
      throw new Error("러닝 기록이 5만 개 제한을 넘었어요.");
    const start = appleDate(a.startDate),
      end = appleDate(a.endDate);
    if (!start || !end || end.ms < start.ms) {
      this.skipped++;
      return;
    }
    const issues = ["apple-summary-only"];
    const fromStats = (
      type: string,
      field: string,
      kind: "distance" | "hr",
    ) => {
      const rows = stats.filter(
        (s) => s.type === `HKQuantityTypeIdentifier${type}`,
      );
      const values = rows.map((s) => quantity(s[field], s.unit, kind));
      const valid = values.filter((n): n is number => n !== null);
      if (new Set(valid).size > 1) {
        issues.push("apple-summary-conflict");
        return null;
      }
      return valid[0] ?? null;
    };
    const legacyDistance = quantity(
      a.totalDistance,
      a.totalDistanceUnit,
      "distance",
    );
    const statsDistance = fromStats(
      "DistanceWalkingRunning",
      "sum",
      "distance",
    );
    let distanceM = statsDistance ?? legacyDistance;
    if (
      legacyDistance !== null &&
      statsDistance !== null &&
      Math.abs(legacyDistance - statsDistance) >
        Math.max(1, statsDistance * 0.001)
    ) {
      distanceM = null;
      issues.push("apple-summary-conflict");
    }
    if (issues.includes("apple-summary-conflict")) distanceM = null;
    const durationMs = quantity(a.duration, a.durationUnit, "duration");
    const meanHr = fromStats("HeartRate", "average", "hr");
    const maxHr = fromStats("HeartRate", "maximum", "hr");
    if (durationMs === null || distanceM === null)
      issues.push("apple-summary-missing");
    // This is a local source group, not an assertion about the watch model.
    const source = a.sourceName
      ? JSON.stringify([a.sourceName, a.device ?? ""])
      : "";
    if (source && !this.sources.has(source))
      this.sources.set(source, `출처 ${this.sources.size + 1}`);
    const deviceGroup = this.sources.get(source) ?? "출처 미상";
    const signature = JSON.stringify([
      source,
      start.ms,
      end.ms,
      durationMs,
      distanceM,
      meanHr,
      maxHr,
    ]);
    // Unknown sources cannot be safely deduplicated.
    if (source && this.signatures.has(signature)) {
      this.duplicates++;
      return;
    }
    if (source) this.signatures.add(signature);
    this.sessions.push({
      id: "",
      source: "apple",
      startMs: start.ms,
      endMs: end.ms,
      offsetMs: start.offsetMs,
      date: localDate(start.ms, start.offsetMs),
      durationMs,
      distanceM,
      meanHr,
      maxHr,
      meanCadence: null,
      reference: null,
      uuid: null,
      updatedMs: null,
      status: "missing",
      deviceGroup,
      issues: [...new Set(issues)],
    });
  }

  finish() {
    this.parser.close();
    if (!this.seenRoot) throw invalidXml();
    // Overlapping exports may be copies saved by several apps. Keep both for
    // review, but do not double-count them in the default totals.
    this.sessions.sort((a, b) => a.startMs - b.startMs);
    let furthest: InternalSummary | undefined;
    for (const s of this.sessions) {
      if (furthest && s.startMs < furthest.endMs!) {
        for (const run of [s, furthest])
          if (!run.issues.includes("apple-overlap"))
            run.issues.push("apple-overlap");
      }
      if (!furthest || s.endMs! > furthest.endMs!) furthest = s;
    }
    this.sessions.reverse();
    this.sessions.forEach((s, i) => {
      s.id = `run-${i + 1}`;
      s.quality = qualityIssues(s);
    });
    const result = {
      sessions: this.sessions,
      warnings: [
        ...(this.skipped
          ? [`시작·종료 시각이 잘못된 러닝 ${this.skipped}개를 읽지 못했어요.`]
          : []),
        ...(this.duplicates
          ? [
              `같은 출처·시각·요약값의 중복 러닝 ${this.duplicates}개를 한 번만 읽었어요.`,
            ]
          : []),
        ...(this.sessions.some((s) => s.issues.includes("apple-overlap"))
          ? [
              "시간이 겹치는 러닝은 중복일 수 있어 기본 합계에서 제외했어요. 각 기록의 원본·분석 설정에서 포함할 기록을 선택해 주세요.",
            ]
          : []),
      ],
    };
    this.sources.clear();
    this.signatures.clear();
    return result;
  }
}
