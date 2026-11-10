import { intervals, primaryRange } from "./analysis";
import type { Interval } from "./analysis";
import { usesSummary } from "./quality";
import type { Detail, Profile, Summary } from "./types";

export interface ReviewStats {
  from: number;
  to: number;
  hr: number | null;
  speed: number | null;
  pace: number | null;
  hrSec: number;
  speedSec: number;
  pairedSec: number;
  hrCoverage: number;
  speedCoverage: number;
  pairedCoverage: number;
}
export interface ReviewBin {
  from: number;
  to: number;
  hr: number | null;
  pace: number | null;
  hrCoverage: number;
  speedCoverage: number;
}
export interface RunReview {
  from: number;
  to: number;
  hrCoverage: number;
  speedCoverage: number;
  pairedCoverage: number;
  bins: ReviewBin[];
  comparison: ReviewStats;
  comparisonBins: ReviewBin[];
  finish: {
    before: ReviewStats;
    last: ReviewStats;
    accelerated: boolean;
    beforeSteady: boolean;
  } | null;
  movement: {
    runningSec: number;
    walkingSec: number;
    stoppedSec: number;
    unknownSec: number;
  };
}
export interface SimilarRun {
  id: string;
  date: string;
  pace: number;
  durationMs: number;
  paceDifference: number;
  durationDifference: number;
}
export interface PastReference {
  from: number;
  to: number;
  dates: number;
  bins: {
    from: number;
    to: number;
    low: number | null;
    median: number | null;
    high: number | null;
    count: number;
    currentHr: number | null;
  }[];
}

function stats(
  values: Interval[],
  from: number,
  to: number,
  pairedOnly = false,
): ReviewStats {
  let hrSum = 0, speedSum = 0, hrSec = 0, speedSec = 0, pairedSec = 0;
  for (const v of values) {
    const sec = Math.max(0, Math.min(to, v.to) - Math.max(from, v.from));
    if (!sec) continue;
    const joint = v.hr !== null && v.speed !== null;
    if (joint) pairedSec += sec;
    if (pairedOnly && !joint) continue;
    if (v.hr !== null) { hrSum += v.hr * sec; hrSec += sec; }
    if (v.speed !== null) { speedSum += v.speed * sec; speedSec += sec; }
  }
  const extent = Math.max(0, to - from);
  const speed = speedSec ? speedSum / speedSec : null;
  return {
    from, to,
    hr: hrSec ? hrSum / hrSec : null,
    speed,
    pace: speed !== null && speed > 0 ? 1000 / speed : null,
    hrSec, speedSec, pairedSec,
    hrCoverage: extent ? hrSec / extent : 0,
    speedCoverage: extent ? speedSec / extent : 0,
    pairedCoverage: extent ? pairedSec / extent : 0,
  };
}

function bin(value: ReviewStats): ReviewBin {
  return {
    from: value.from, to: value.to,
    hr: value.hrCoverage >= 0.9 ? value.hr : null,
    pace: value.speedCoverage >= 0.9 ? value.pace : null,
    hrCoverage: value.hrCoverage,
    speedCoverage: value.speedCoverage,
  };
}

/** Compact summaries retain missing time and never fill a sensor gap. */
export function summarizeRun(detail: Detail): RunReview {
  const [from, to] = primaryRange(detail);
  const values = intervals(detail, from, to);
  const overall = stats(values, from, to);
  const width = Math.max(30, Math.ceil((to - from) / 60));
  const count = Math.min(60, Math.ceil(Math.max(0, to - from) / width));
  // The number of bins is capped, even when the source spans a very long gap.
  const bins = Array.from({ length: count }, (_, i) =>
    bin(stats(values, from + i * width, Math.min(to, from + (i + 1) * width))),
  );
  const comparison = stats(values, 300, 1200, true);
  const comparisonBins = Array.from({ length: 15 }, (_, i) =>
    bin(stats(values, 300 + i * 60, 360 + i * 60, true)),
  );
  const movement = { runningSec: 0, walkingSec: 0, stoppedSec: 0, unknownSec: 0 };
  for (const v of values) {
    if (v.speed === null) continue;
    if (v.speed < 0.3) movement.stoppedSec += v.sec;
    else if (v.speed < 1.8) movement.walkingSec += v.sec;
    else movement.runningSec += v.sec;
  }
  movement.unknownSec = Math.max(0, to - from - overall.speedSec);
  let finish: RunReview["finish"] = null;
  if (to - Math.max(300, from) >= 480) {
    const before = stats(values, to - 480, to - 180);
    const last = stats(values, to - 180, to);
    const faster = (value: ReviewStats) =>
      value.speedCoverage >= 0.9 && value.speed !== null &&
      before.speed !== null && before.speed > 0 &&
      value.speed / before.speed >= 1.1 &&
      before.pace !== null && value.pace !== null && before.pace - value.pace >= 20;
    const minutes = [0, 1, 2].map((i) => stats(values, to - 180 + i * 60, to - 120 + i * 60));
    // At least two final minutes, including the last, must support the change.
    const accelerated = before.speedCoverage >= 0.9 && faster(last) &&
      minutes.every((v) => v.speedCoverage >= 0.9) &&
      minutes.filter(faster).length >= 2 && faster(minutes[2]);
    const steadyFrom = Math.max(from, 300), steadyTo = to - 180;
    const mid = (steadyFrom + steadyTo) / 2;
    const a = stats(values, steadyFrom, mid), b = stats(values, mid, steadyTo);
    const beforeSteady = mid - steadyFrom >= 300 &&
      a.speedCoverage >= 0.9 && b.speedCoverage >= 0.9 &&
      a.speed !== null && b.speed !== null && a.speed > 0 &&
      Math.abs(b.speed / a.speed - 1) <= 0.05;
    finish = { before, last, accelerated, beforeSteady };
  }
  return { from, to, hrCoverage: overall.hrCoverage,
    speedCoverage: overall.speedCoverage, pairedCoverage: overall.pairedCoverage,
    bins, comparison, comparisonBins, finish, movement };
}

function eligible(s: Summary) {
  return s.source !== "apple" && !s.growthExcluded &&
    s.durationMs !== null && Number.isFinite(s.durationMs) && s.durationMs > 0 &&
    usesSummary(s, "duration") && s.offsetMs !== null &&
    !!s.deviceGroup && s.deviceGroup !== "출처 미상";
}

function allSimilarRuns(current: Summary, sessions: Summary[], profiles: Profile[]): SimilarRun[] {
  if (!eligible(current)) return [];
  const reviews = new Map(profiles.map((p) => [p.id, p.review]));
  const base = reviews.get(current.id)?.comparison;
  if (!base || base.pairedCoverage < 0.9 || base.pace === null) return [];
  const matches: SimilarRun[] = [];
  for (const s of sessions) {
    if (s.id === current.id || !eligible(s) || s.date >= current.date ||
      s.startMs >= current.startMs || current.startMs - s.startMs > 56 * 86400000 ||
      s.deviceGroup !== current.deviceGroup || (s.source ?? "samsung") !== (current.source ?? "samsung")) continue;
    const input = reviews.get(s.id)?.comparison;
    if (!input || input.pairedCoverage < 0.9 || input.pace === null) continue;
    const durationDifference = Math.abs(s.durationMs! - current.durationMs!) / current.durationMs!;
    const paceDifference = Math.abs(input.pace - base.pace) / base.pace;
    if (durationDifference > 0.35 || paceDifference > 0.08) continue;
    matches.push({ id: s.id, date: s.date, pace: input.pace,
      durationMs: s.durationMs!, durationDifference, paceDifference });
  }
  // Input workload and recency only. Heart-rate outcomes never affect ranking.
  const score = (s: SimilarRun) => s.paceDifference / 0.08 + s.durationDifference / 0.35;
  return matches.sort((a, b) =>
    score(a) - score(b) ||
    b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function suggestSimilarRuns(current: Summary, sessions: Summary[], profiles: Profile[]): SimilarRun[] {
  return allSimilarRuns(current, sessions, profiles).slice(0, 3);
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/** One mean per distinct past date; neither current outcomes nor point counts select runs. */
export function buildPastReference(current: Summary, sessions: Summary[], profiles: Profile[]): PastReference | null {
  const reviews = new Map(profiles.map((p) => [p.id, p.review]));
  const base = reviews.get(current.id);
  if (!base) return null;
  const dates = new Set<string>();
  const selected = allSimilarRuns(current, sessions, profiles).filter((s) => {
    if (dates.has(s.date)) return false;
    dates.add(s.date); return true;
  });
  if (selected.length < 5) return null;
  const bins = base.comparisonBins.map((now) => {
    const hrs: number[] = [];
    if (now.pace !== null) for (const s of selected) {
      const previous = reviews.get(s.id)?.comparisonBins.find((b) => b.from === now.from && b.to === now.to);
      if (previous?.hr === null || previous?.hr === undefined || previous.pace === null ||
        Math.abs(previous.pace / now.pace - 1) > 0.08) continue;
      hrs.push(previous.hr);
    }
    return { from: now.from, to: now.to, currentHr: now.hr,
      low: hrs.length >= 5 ? percentile(hrs, 0.25) : null,
      median: hrs.length >= 5 ? percentile(hrs, 0.5) : null,
      high: hrs.length >= 5 ? percentile(hrs, 0.75) : null,
      count: hrs.length };
  });
  return bins.some((b) => b.low !== null) ? { from: 300, to: 1200, dates: selected.length, bins } : null;
}
