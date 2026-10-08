import type {
  Detail,
  EvidenceRef,
  Profile,
  StableWindow,
  Summary,
} from "./types";
import { datedActivity, usesSummary } from "./quality";
export const ANALYSIS_VERSION = "0.2.0";
export const STABILITY_DEFAULTS = {
  context: 120,
  cv: 0.08,
  transition: 0.05,
  width: 0.08,
};
export type Interval = {
  from: number;
  to: number;
  sec: number;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
  index: number;
};
export function intervals(d: Detail, from = 0, to = Infinity): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < d.points.length - 1; i++) {
    const p = d.points[i],
      n = d.points[i + 1],
      dt = n.time - p.time;
    if (dt <= 0 || dt > d.gapSec || n.time <= from || p.time >= to) continue;
    const a = Math.max(from, p.time),
      b = Math.min(to, n.time);
    if (b <= a) continue;
    out.push({
      from: a,
      to: b,
      sec: b - a,
      index: i,
      hr: p.hr !== null && n.hr !== null ? p.hr : null,
      speed: p.speed !== null && n.speed !== null ? p.speed : null,
      cadence: p.cadence !== null && n.cadence !== null ? p.cadence : null,
    });
  }
  return out;
}
export function quantile(
  values: { value: number; weight: number }[],
  q: number,
): number | null {
  const a = values
    .filter((x) => Number.isFinite(x.value) && x.weight > 0)
    .sort((x, y) => x.value - y.value);
  const total = a.reduce((s, x) => s + x.weight, 0);
  if (!total) return null;
  let sum = 0;
  for (const x of a) {
    sum += x.weight;
    if (sum >= total * q) return x.value;
  }
  return a.at(-1)!.value;
}
export function metricStats(
  d: Detail,
  from: number,
  to: number,
  key: "hr" | "speed" | "cadence",
) {
  const valid = intervals(d, from, to).filter((x) => x[key] !== null);
  const sec = valid.reduce((s, x) => s + x.sec, 0);
  return {
    sec,
    coverage: to > from ? sec / (to - from) : 0,
    mean: sec ? valid.reduce((s, x) => s + x[key]! * x.sec, 0) / sec : null,
    median: quantile(
      valid.map((x) => ({ value: x[key]!, weight: x.sec })),
      0.5,
    ),
  };
}
export function timeSegments(d: Detail) {
  const groups: {
    from: number;
    to: number;
    observed: number;
    points: number;
  }[] = [];
  for (let i = 0; i < d.points.length; i++) {
    const p = d.points[i],
      last = groups.at(-1);
    if (!last || p.time - last.to > Math.max(600, d.gapSec * 10))
      groups.push({ from: p.time, to: p.time, observed: 0, points: 1 });
    else {
      last.to = p.time;
      last.points++;
    }
  }
  const segments = intervals(d);
  let index = 0;
  for (const v of segments) {
    while (index < groups.length - 1 && v.from >= groups[index + 1].from)
      index++;
    if (v.hr !== null || v.speed !== null) groups[index].observed += v.sec;
  }
  return groups;
}
export function primaryRange(d: Detail): [number, number] {
  const groups = timeSegments(d),
    end = d.points.at(-1)?.time ?? 0;
  const total = groups.reduce((s, g) => s + g.observed, 0);
  const main = [...groups].sort((a, b) => b.observed - a.observed)[0];
  return main &&
    total > 0 &&
    main.observed / total >= 0.8 &&
    main.to - main.from >= 300 &&
    end > 3 * (main.to - main.from)
    ? [main.from, main.to]
    : [0, end];
}
export function longestRun(d: Detail) {
  let longest = 0,
    sec = 0,
    end = -1;
  for (const x of intervals(d)) {
    const n = d.points[x.index + 1];
    if (
      x.speed === null ||
      x.speed < 1.8 ||
      n.speed === null ||
      n.speed < 1.8
    ) {
      sec = 0;
      end = -1;
      continue;
    }
    sec = x.from === end ? sec + x.sec : x.sec;
    end = x.to;
    longest = Math.max(longest, sec);
  }
  return longest;
}
export function halfComparison(
  d: Detail,
): NonNullable<Profile["halves"]> | null {
  const [start, to] = primaryRange(d),
    from = Math.max(300, start),
    mid = (from + to) / 2;
  if (mid - from < 300) return null;
  const half = (a: number, b: number) => {
    const v = intervals(d, a, b).filter(
        (x) => x.hr !== null && x.speed !== null,
      ),
      sec = v.reduce((s, x) => s + x.sec, 0);
    return {
      sec,
      coverage: sec / (b - a),
      hr: sec ? v.reduce((s, x) => s + x.hr! * x.sec, 0) / sec : 0,
      speed: sec ? v.reduce((s, x) => s + x.speed! * x.sec, 0) / sec : 0,
    };
  };
  const first = half(from, mid),
    last = half(mid, to);
  return first.coverage >= 0.7 && last.coverage >= 0.7
    ? {
        from,
        to,
        first,
        last,
        speedDifference:
          Math.abs(first.speed - last.speed) /
          ((first.speed + last.speed) / 2 || 1),
      }
    : null;
}
export function buildStableWindows(d: Detail, cfg = STABILITY_DEFAULTS) {
  const windows: StableWindow[] = [],
    diagnostics: Record<string, number> = {};
  const input = intervals(d),
    gapTimes = d.points
      .slice(1)
      .flatMap((p, i) =>
        p.time - d.points[i].time > d.gapSec
          ? [{ from: d.points[i].time, to: p.time }]
          : [],
      );
  let cursor = 0;
  const contextBefore = cfg.context - 60;
  const first = Math.ceil((300 + contextBefore) / 60) * 60;
  const starts = new Set<number>();
  for (const x of input)
    for (
      let t = Math.max(first, Math.ceil((x.from - 60) / 60) * 60);
      t <= x.to;
      t += 60
    )
      if (t + 60 <= (d.points.at(-1)?.time ?? 0)) starts.add(t);
  for (const t of [...starts].sort((a, b) => a - b)) {
    const a = t - contextBefore,
      b = t + 60;
    while (cursor < input.length && input[cursor].to <= a) cursor++;
    const slice: Interval[] = [];
    for (let i = cursor; i < input.length && input[i].from < b; i++) {
      const x = input[i],
        from = Math.max(a, x.from),
        to = Math.min(b, x.to);
      if (to > from) slice.push({ ...x, from, to, sec: to - from });
    }
    let reason = "";
    const speeds = slice.filter((x) => x.speed !== null),
      sec = speeds.reduce((s, x) => s + x.sec, 0);
    const mean = sec
      ? speeds.reduce((s, x) => s + x.speed! * x.sec, 0) / sec
      : 0;
    const cv = mean
      ? Math.sqrt(
          speeds.reduce((s, x) => s + (x.speed! - mean) ** 2 * x.sec, 0) /
            (sec || 1),
        ) / mean
      : Infinity;
    const speedMean = (lo: number, hi: number) => {
      const v = speeds.map((x) => ({
        ...x,
        sec: Math.max(0, Math.min(hi, x.to) - Math.max(lo, x.from)),
      }));
      const n = v.reduce((s, x) => s + x.sec, 0);
      return n ? v.reduce((s, x) => s + x.speed! * x.sec, 0) / n : null;
    };
    const early = speedMean(a, t),
      late = speedMean(t, b);
    if (sec / cfg.context < 0.8) reason = "speed-coverage";
    else if (gapTimes.some((g) => g.from < b && g.to > a)) reason = "gap";
    else if (
      speeds.some(
        (x) =>
          x.speed! < 1.8 ||
          (d.points[x.index + 1].speed !== null &&
            d.points[x.index + 1].speed! < 1.8),
      )
    )
      reason = "slow-or-stop";
    else if (
      speeds.some(
        (x) =>
          Math.abs(d.points[x.index + 1].speed! - x.speed!) / (x.speed! || 1) >
          0.2,
      )
    )
      reason = "abrupt-speed";
    else if (cv > cfg.cv) reason = "variation";
    else if (
      early === null ||
      late === null ||
      Math.abs(early - late) / ((early + late) / 2) > cfg.transition
    )
      reason = "transition";
    const measured = slice.flatMap((x) => {
      const from = Math.max(t, x.from),
        to = Math.min(b, x.to);
      return to > from && x.hr !== null && x.speed !== null
        ? [{ ...x, from, to, sec: to - from }]
        : [];
    });
    const observed = measured.reduce((s, x) => s + x.sec, 0),
      samples = new Set(measured.map((x) => x.index)).size;
    if (!reason && observed / 60 < 0.8) reason = "paired-coverage";
    if (!reason && samples < 4) reason = "samples";
    if (reason) {
      diagnostics[reason] = (diagnostics[reason] ?? 0) + 1;
      continue;
    }
    windows.push({
      from: t,
      to: b,
      sec: observed,
      samples,
      cv,
      hr: measured.reduce((s, x) => s + x.hr! * x.sec, 0) / observed,
      speed: measured.reduce((s, x) => s + x.speed! * x.sec, 0) / observed,
    });
  }
  diagnostics.accepted = windows.length;
  return { windows, diagnostics };
}
export const dayNumber = (date: string) =>
  Date.parse(date + "T00:00:00Z") / 86400000;
export const dateAt = (day: number) =>
  new Date(day * 86400000).toISOString().slice(0, 10);
export type Question = "heart" | "pace";
export type CompareState =
  "ready" | "reference" | "conditions" | "insufficient" | "sensitive";
export interface CompareConfig {
  question: Question;
  days: number;
  anchor: string;
  target: number;
  device: string;
  phases: number[];
  width: number;
  elapsedFrom: number;
  elapsedTo: number;
}
export interface CompareRow {
  id: string;
  date: string;
  epoch: number;
  value: number;
  q: number;
  sec: number;
  samples: number;
  windows: StableWindow[];
  period: "previous" | "recent";
}
interface PhaseEstimate {
  value: number | null;
  input: number | null;
  elapsed: number | null;
  effective: number;
  sec: number;
  rows: number;
}
export interface PeriodEstimate {
  value: number | null;
  count: number;
  days: number;
  effective: number;
  sec: number;
  samples: number;
  iqr: [number, number] | null;
  phases: PhaseEstimate[];
  rows: CompareRow[];
}
export interface Comparison {
  config: CompareConfig;
  state: CompareState;
  baseState: CompareState;
  reason: string[];
  previous: PeriodEstimate;
  recent: PeriodEstimate;
  difference: number | null;
  range: [number, number] | null;
  periods: { previous: [string, string]; recent: [string, string] };
  sensitivity: { min: number; max: number; variants: number } | null;
  candidates: number;
  excluded: { id: string; date: string; reason: string }[];
  analysisVersion: string;
  inputRevision: number;
}
const effective = (weights: number[]) => {
  const sum = weights.reduce((a, b) => a + b, 0),
    squares = weights.reduce((a, b) => a + b * b, 0);
  return squares ? (sum * sum) / squares : 0;
};
export const kernel = (u: number) => (u < 1 ? (1 - u ** 3) ** 3 : 0);
function candidates(
  sessions: Summary[],
  profiles: Profile[],
  cfg: CompareConfig,
) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const t = dayNumber(cfg.anchor);
  const excluded: Comparison["excluded"] = [];
  const out: {
    s: Summary;
    windows: StableWindow[];
    period: "previous" | "recent";
  }[] = [];
  for (const s of sessions) {
    const day = dayNumber(s.date);
    if (day < t - cfg.days * 2 + 1 || day > t) continue;
    const windows = (byId.get(s.id)?.windows ?? []).filter(
      (w) => w.from >= cfg.elapsedFrom && w.to <= cfg.elapsedTo,
    );
    const detailReason =
      s.status === "limited"
        ? "파일이 커서 일부 기록만 분석했어요"
        : s.status === "missing"
          ? "시간별 측정 파일 없음"
          : s.status === "invalid"
            ? "측정 파일을 읽지 못함"
            : byId.get(s.id)?.hrSec === 0
              ? "심박 측정값 없음"
              : "";
    const reason =
      s.offsetMs === null
        ? "시간대 정보 없음"
        : s.growthExcluded
          ? "직접 비교에서 뺀 기록"
          : cfg.device !== "all" && s.deviceGroup !== cfg.device
            ? "선택한 기기와 다름"
            : s.durationMs !== null &&
                s.durationMs < 60000 &&
                s.inclusion !== "include"
              ? "1분 미만인 기록"
              : detailReason
                ? detailReason
                : windows.length < 3 ||
                    windows.reduce((n, w) => n + w.sec, 0) < 180
                  ? "속도가 안정적인 측정 구간이 3개·3분보다 적어요"
                  : "";
    if (reason) {
      excluded.push({ id: s.id, date: s.date, reason });
      continue;
    }
    out.push({
      s,
      windows,
      period: day >= t - cfg.days + 1 ? "recent" : "previous",
    });
  }
  return { out, excluded };
}
function estimate(
  entries: ReturnType<typeof candidates>["out"],
  cfg: CompareConfig,
): PeriodEstimate {
  const input = cfg.question === "heart" ? "speed" : "hr",
    response = cfg.question === "heart" ? "hr" : "speed";
  const target = cfg.question === "heart" ? 1000 / cfg.target : cfg.target;
  const h = cfg.question === "heart" ? target * cfg.width : cfg.width;
  const accum = new Map<
    string,
    {
      s: Summary;
      sum: number;
      weight: number;
      q: number;
      sec: number;
      samples: number;
      windows: StableWindow[];
      period: "previous" | "recent";
    }
  >();
  const phases: PhaseEstimate[] = cfg.phases.map((phase) => {
    let sum = 0,
      weight = 0,
      inputs = 0,
      elapsed = 0,
      sec = 0;
    const qs: number[] = [];
    for (const e of entries) {
      const windows = e.windows.filter(
        (w) => Math.floor(w.from / 300) === phase,
      );
      const D = windows.reduce((n, w) => n + w.sec, 0);
      if (!D) continue;
      let q = 0;
      for (const w of windows) {
        const k = kernel(Math.abs(w[input] - target) / (h || 1)),
          a = (w.sec / D) * k;
        if (!a) continue;
        q += a;
        sum += a * w[response];
        weight += a;
        inputs += a * w[input];
        elapsed += (a * (w.from + w.to)) / 2;
        sec += w.sec * k;
        let r = accum.get(e.s.id);
        if (!r) {
          r = {
            s: e.s,
            sum: 0,
            weight: 0,
            q: 0,
            sec: 0,
            samples: 0,
            windows: [],
            period: e.period,
          };
          accum.set(e.s.id, r);
        }
        r.sum += a * w[response];
        r.weight += a;
        r.sec += w.sec * k;
        r.samples += w.samples;
        r.windows.push(w);
      }
      if (q) qs.push(q);
      const r = accum.get(e.s.id);
      if (r) r.q += q / cfg.phases.length;
    }
    return {
      value: weight ? sum / weight : null,
      input: weight ? inputs / weight : null,
      elapsed: weight ? elapsed / weight : null,
      effective: effective(qs),
      sec,
      rows: qs.length,
    };
  });
  const rows = [...accum.values()].map((r) => ({
    id: r.s.id,
    date: r.s.date,
    epoch: dayNumber(r.s.date) * 86400000,
    value:
      cfg.question === "heart" ? r.sum / r.weight : 1000 / (r.sum / r.weight),
    q: r.q,
    sec: r.sec,
    samples: r.samples,
    windows: r.windows,
    period: r.period,
  }));
  const value =
    phases.length && phases.every((p) => p.value !== null)
      ? phases.reduce((s, p) => s + p.value!, 0) / phases.length
      : null;
  const low = quantile(
      rows.map((r) => ({ value: r.value, weight: r.q })),
      0.25,
    ),
    high = quantile(
      rows.map((r) => ({ value: r.value, weight: r.q })),
      0.75,
    );
  return {
    value:
      value === null
        ? null
        : cfg.question === "heart"
          ? value
          : value > 0
            ? 1000 / value
            : null,
    count: rows.length,
    days: new Set(rows.map((r) => r.date)).size,
    effective: effective(rows.map((r) => r.q)),
    sec: phases.reduce((n, p) => n + p.sec, 0),
    samples: rows.reduce((n, r) => n + r.samples, 0),
    iqr: low === null || high === null ? null : [low, high],
    phases,
    rows,
  };
}
function supported(p: PeriodEstimate, ready: boolean) {
  return (
    p.value !== null &&
    p.count >= (ready ? 5 : 3) &&
    p.days >= (ready ? 3 : 2) &&
    p.effective >= (ready ? 5 : 3) - 1e-8 &&
    p.sec >= (ready ? 600 : 300) &&
    p.phases.every((j) => j.effective >= (ready ? 3 : 2) - 1e-8)
  );
}
export function compare(
  sessions: Summary[],
  profiles: Profile[],
  cfg: CompareConfig,
  sensitivity = true,
  inputRevision = 0,
): Comparison {
  const { out, excluded } = candidates(sessions, profiles, cfg),
    previous = estimate(
      out.filter((e) => e.period === "previous"),
      cfg,
    ),
    recent = estimate(
      out.filter((e) => e.period === "recent"),
      cfg,
    );
  const input = cfg.question === "heart" ? "speed" : "hr";
  const ranges = (["previous", "recent"] as const).map((period) => {
    const ws = out
      .filter((e) => e.period === period)
      .flatMap((e) =>
        e.windows.filter((w) => cfg.phases.includes(Math.floor(w.from / 300))),
      );
    return [
      quantile(
        ws.map((w) => ({ value: w[input], weight: w.sec })),
        0.1,
      ),
      quantile(
        ws.map((w) => ({ value: w[input], weight: w.sec })),
        0.9,
      ),
    ];
  });
  const lo = ranges.every((r) => r[0] !== null)
    ? Math.max(ranges[0][0]!, ranges[1][0]!)
    : null;
  const hi = ranges.every((r) => r[1] !== null)
    ? Math.min(ranges[0][1]!, ranges[1][1]!)
    : null;
  const target = cfg.question === "heart" ? 1000 / cfg.target : cfg.target;
  const range: [number, number] | null =
    lo !== null && hi !== null && hi >= lo ? [lo, hi] : null;
  const inRange =
    range !== null && target >= range[0] - 1e-9 && target <= range[1] + 1e-9;
  const reason: string[] = [];
  let state: CompareState =
    cfg.phases.length >= 2 &&
    inRange &&
    supported(previous, true) &&
    supported(recent, true)
      ? "ready"
      : cfg.phases.length >= 2 &&
          inRange &&
          supported(previous, false) &&
          supported(recent, false)
        ? "reference"
        : "insufficient";
  if (!inRange)
    reason.push("선택한 페이스·심박이 두 기간의 공통 측정 범위 밖이에요.");
  if (cfg.phases.length < 2)
    reason.push("두 기간 모두 측정값이 충분한 운동 구간이 2개보다 적어요.");
  if (!supported(previous, false) || !supported(recent, false))
    reason.push(
      "각 기간 3회·2일·유효 3회·가중 5분, 구간별 유효 2회 이상이 필요해요.",
    );
  if (state !== "insufficient") {
    const mismatch = previous.phases.some((p, i) => {
      const n = recent.phases[i];
      if (
        p.input === null ||
        n.input === null ||
        p.elapsed === null ||
        n.elapsed === null
      )
        return true;
      return (
        (cfg.question === "heart"
          ? Math.abs(p.input - n.input) / ((p.input + n.input) / 2) > 0.01
          : Math.abs(p.input - n.input) > 2) ||
        Math.abs(p.elapsed - n.elapsed) > 60
      );
    });
    if (cfg.device === "all" || cfg.device === "출처 미상" || mismatch) {
      state = "conditions";
      reason.push(
        cfg.device === "all" || cfg.device === "출처 미상"
          ? "기기가 다르거나 기기 정보가 없어 참고로만 봐주세요."
          : "실제 페이스·심박이나 운동 시점이 달랐어요. 비교 구간을 확인해 주세요.",
      );
    }
  }
  const difference =
    previous.value !== null && recent.value !== null
      ? recent.value - previous.value
      : null;
  const baseState = state;
  let sensitivityRange: Comparison["sensitivity"] = null;
  if (sensitivity && state !== "insufficient" && difference !== null) {
    const variants: Comparison[] = [];
    for (const width of cfg.question === "heart" ? [0.06, 0.1] : [8, 12])
      variants.push(compare(sessions, profiles, { ...cfg, width }, false));
    for (const e of out)
      variants.push(
        compare(
          sessions.filter((s) => s.id !== e.s.id),
          profiles,
          cfg,
          false,
        ),
      );
    const diffs = variants.flatMap((v) =>
      v.difference === null ? [] : [v.difference],
    );
    if (diffs.length) {
      sensitivityRange = {
        min: Math.min(difference, ...diffs),
        max: Math.max(difference, ...diffs),
        variants: variants.length,
      };
      if (
        variants.some(
          (v) =>
            v.state !== baseState ||
            (v.difference !== null &&
              Math.sign(v.difference) !== Math.sign(difference)),
        )
      ) {
        state = "sensitive";
        reason.push(
          "비교 범위를 바꾸거나 러닝 하나를 빼면 차이의 방향이나 비교 가능 여부가 달라져요.",
        );
      }
    }
  }
  const t = dayNumber(cfg.anchor);
  return {
    config: cfg,
    state,
    baseState,
    reason,
    previous,
    recent,
    difference,
    range,
    sensitivity: sensitivityRange,
    candidates: out.length,
    excluded,
    analysisVersion: ANALYSIS_VERSION,
    inputRevision,
    periods: {
      previous: [dateAt(t - 2 * cfg.days + 1), dateAt(t - cfg.days)],
      recent: [dateAt(t - cfg.days + 1), dateAt(t)],
    },
  };
}
export function suggestComparison(
  sessions: Summary[],
  profiles: Profile[],
  question: Question = "heart",
  days = 28,
  elapsedFrom = 300,
  elapsedTo = 1200,
  anchor?: string,
): CompareConfig {
  const eligibleIds = new Set(
    profiles
      .filter((p) => {
        const windows = (p.windows ?? []).filter(
          (w) => w.from >= elapsedFrom && w.to <= elapsedTo,
        );
        return (
          windows.length >= 3 &&
          windows.reduce((sum, w) => sum + w.sec, 0) >= 180
        );
      })
      .map((p) => p.id),
  );
  const knownDates = sessions.filter(
    (s) =>
      s.offsetMs !== null &&
      !s.growthExcluded &&
      (s.durationMs === null ||
        s.durationMs >= 60000 ||
        s.inclusion === "include"),
  );
  const latest =
    [...knownDates.filter((s) => eligibleIds.has(s.id))].sort((a, b) =>
      b.date.localeCompare(a.date),
    )[0]?.date ??
    [...knownDates].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ??
    sessions[0]?.date ??
    "2000-01-01";
  const cfg: CompareConfig = {
    question,
    days,
    anchor: anchor ?? latest,
    target: question === "heart" ? 420 : 140,
    device: "all",
    phases: Array.from(
      { length: Math.floor((elapsedTo - elapsedFrom) / 300) },
      (_, i) => Math.floor(elapsedFrom / 300) + i,
    ),
    width: question === "heart" ? 0.08 : 10,
    elapsedFrom,
    elapsedTo,
  };
  const groups = [
    ...new Set(sessions.map((s) => s.deviceGroup ?? "출처 미상")),
  ].filter((x) => x !== "출처 미상");
  let best = 0;
  for (const device of groups) {
    const { out } = candidates(sessions, profiles, { ...cfg, device });
    const score = Math.min(
      ...(["previous", "recent"] as const).map((p) =>
        out
          .filter((e) => e.period === p)
          .reduce((n, e) => n + e.windows.reduce((v, w) => v + w.sec, 0), 0),
      ),
    );
    if (score > best) {
      best = score;
      cfg.device = device;
    }
  }
  const { out } = candidates(sessions, profiles, cfg),
    input = question === "heart" ? "speed" : "hr";
  const bounds = (["previous", "recent"] as const).map((p) => {
    const ws = out.filter((e) => e.period === p).flatMap((e) => e.windows);
    return [
      quantile(
        ws.map((w) => ({ value: w[input], weight: w.sec })),
        0.1,
      ),
      quantile(
        ws.map((w) => ({ value: w[input], weight: w.sec })),
        0.9,
      ),
    ];
  });
  if (bounds.some((b) => b.some((v) => v === null))) return cfg;
  const lo = Math.max(bounds[0][0]!, bounds[1][0]!),
    hi = Math.min(bounds[0][1]!, bounds[1][1]!);
  if (hi < lo) return cfg;
  const all = out.flatMap((e) => e.windows),
    median = quantile(
      all.map((w) => ({ value: w[input], weight: w.sec })),
      0.5,
    )!;
  const low = question === "heart" ? 1000 / hi : lo,
    high = question === "heart" ? 1000 / lo : hi,
    step = question === "heart" ? 5 : 1;
  const targets = [question === "heart" ? 1000 / median : median];
  for (let n = Math.ceil(low / step) * step; n <= high; n += step)
    targets.push(n);
  let score = -1,
    seconds = -1,
    distance = Infinity;
  const availablePhases = [...cfg.phases];
  for (const target of targets) {
    const test = { ...cfg, target, phases: availablePhases };
    const estimates = (["previous", "recent"] as const).map((p) =>
      estimate(
        out.filter((e) => e.period === p),
        test,
      ),
    );
    const phases = availablePhases.filter((_, i) =>
      estimates.every((e) => e.phases[i].effective >= 2),
    );
    if (phases.length < 2) continue;
    const matched = (["previous", "recent"] as const).map((p) =>
      estimate(
        out.filter((e) => e.period === p),
        { ...test, phases },
      ),
    );
    const v = Math.min(...matched.map((e) => e.effective)),
      sec = Math.min(...matched.map((e) => e.sec)),
      dist = Math.abs((question === "heart" ? 1000 / target : target) - median);
    if (
      v > score + 1e-8 ||
      (Math.abs(v - score) < 1e-8 &&
        (sec > seconds + 1e-8 ||
          (Math.abs(sec - seconds) < 1e-8 && dist < distance)))
    ) {
      cfg.target = target;
      cfg.phases = phases;
      score = v;
      seconds = sec;
      distance = dist;
    }
  }
  return cfg;
}
export function evidence(row: CompareRow): EvidenceRef[] {
  return row.windows.map((w) => ({ id: row.id, from: w.from, to: w.to }));
}
export const STATE_LABEL: Record<CompareState, string> = {
  ready: "비교 가능",
  reference: "참고용",
  conditions: "조건 다름",
  insufficient: "기록 부족",
  sensitive: "설정 영향 있음",
};
export function trainingRows(
  sessions: Summary[],
  profiles: Profile[],
  period: "week" | "month" = "week",
) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const grouped = new Map<
    string,
    {
      date: string;
      days: Set<string>;
      count: number;
      distance: number | null;
      minutes: number | null;
      durations: number[];
      longest: number[];
      ids: string[];
    }
  >();
  const known = sessions.filter((s) => s.offsetMs !== null);
  for (const s of known) {
    const d = new Date(s.date + "T00:00:00Z");
    if (period === "week")
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    else d.setUTCDate(1);
    const key = d.toISOString().slice(0, 10);
    const g = grouped.get(key) ?? {
      date: key,
      days: new Set<string>(),
      count: 0,
      distance: null,
      minutes: null,
      durations: [],
      longest: [],
      ids: [],
    };
    if (usesSummary(s, "distance") && s.distanceM !== null)
      g.distance = (g.distance ?? 0) + s.distanceM / 1000;
    if (usesSummary(s, "duration") && s.durationMs !== null) {
      g.minutes = (g.minutes ?? 0) + s.durationMs / 60000;
      g.durations.push(s.durationMs / 60_000);
    }
    if (datedActivity(s)) {
      g.days.add(s.date);
      g.count++;
      g.ids.push(s.id);
      const p = byId.get(s.id);
      if (p?.longestRunSec) g.longest.push(p.longestRunSec / 60);
    }
    grouped.set(key, g);
  }
  const sorted = [...grouped.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (!sorted.length) return [];
  const out: typeof sorted = [];
  const date = new Date(sorted[0].date + "T00:00:00Z"),
    end = sorted.at(-1)!.date;
  const boundedStart = new Date(end + "T00:00:00Z");
  if (period === "week")
    boundedStart.setUTCDate(boundedStart.getUTCDate() - 119 * 7);
  else boundedStart.setUTCMonth(boundedStart.getUTCMonth() - 119);
  if (date < boundedStart) date.setTime(boundedStart.getTime());
  while (date.toISOString().slice(0, 10) <= end) {
    const key = date.toISOString().slice(0, 10);
    out.push(
      grouped.get(key) ?? {
        date: key,
        days: new Set(),
        count: 0,
        distance: null,
        minutes: null,
        durations: [],
        longest: [],
        ids: [],
      },
    );
    if (period === "week") date.setUTCDate(date.getUTCDate() + 7);
    else date.setUTCMonth(date.getUTCMonth() + 1);
  }
  const latest = known.reduce((a, s) => (s.date > a ? s.date : a), "");
  return out.map((g) => ({
    ...g,
    days: g.days.size,
    epoch: dayNumber(g.date) * 86400000,
    durationMedian: quantile(
      g.durations.map((value) => ({ value, weight: 1 })),
      0.5,
    ),
    durationIqr: [
      quantile(
        g.durations.map((value) => ({ value, weight: 1 })),
        0.25,
      ),
      quantile(
        g.durations.map((value) => ({ value, weight: 1 })),
        0.75,
      ),
    ],
    longestMedian: quantile(
      g.longest.map((value) => ({ value, weight: 1 })),
      0.5,
    ),
    longestIqr: [
      quantile(
        g.longest.map((value) => ({ value, weight: 1 })),
        0.25,
      ),
      quantile(
        g.longest.map((value) => ({ value, weight: 1 })),
        0.75,
      ),
    ],
    partial:
      period === "week"
        ? latest < dateAt(dayNumber(g.date) + 6)
        : latest <
          new Date(
            Date.UTC(Number(g.date.slice(0, 4)), Number(g.date.slice(5, 7)), 0),
          )
            .toISOString()
            .slice(0, 10),
  }));
}
