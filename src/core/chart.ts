import type { Detail, Point } from "./types";
import { intervals, quantile } from "./analysis";
export type Metric = "hr" | "pace" | "cadence";
export const METRICS: Metric[] = ["hr", "pace", "cadence"];
export const metricInfo = {
  hr: { label: "심박", unit: "bpm", color: "var(--heart)", dash: undefined },
  pace: { label: "페이스", unit: "/km", color: "var(--pace)", dash: "7 4" },
  cadence: {
    label: "케이던스",
    unit: "회/분",
    color: "var(--cadence)",
    dash: "2 4",
  },
};
export function domain(points: Point[], key: Metric): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of points) {
    const v = p[key];
    if (v !== null) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  const pad = Math.max((hi - lo) * 0.12, key === "pace" ? 10 : 5);
  if (key === "hr" && hi - lo + pad * 2 < 20) {
    const mid = (hi + lo) / 2;
    return [Math.max(0, Math.floor(mid - 10)), Math.ceil(mid + 10)];
  }
  return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
}
export function paceDomain(
  detail: Detail,
  from: number,
  to: number,
  full = false,
): [number, number] {
  const points = detail.points.filter((p) => p.time >= from && p.time <= to);
  if (full) return domain(points, "pace");
  const valid = intervals(detail, from, to).filter(
    (x) => x.speed !== null && x.speed > 0,
  );
  const running = valid.filter(
    (x) => x.speed! >= 1.8 && detail.points[x.index + 1].speed! >= 1.8,
  );
  const sec = running.reduce((s, x) => s + x.sec, 0),
    all = valid.reduce((s, x) => s + x.sec, 0);
  if (sec < 180 || !all || sec / all < 0.6) return domain(points, "pace");
  const values = running.map((x) => ({
    value: 1000 / x.speed!,
    weight: x.sec,
  }));
  let low = quantile(values, 0.02)! - 15,
    high = quantile(values, 0.98)! + 15;
  if (high - low < 60) {
    const mid = (high + low) / 2;
    low = mid - 30;
    high = mid + 30;
  }
  return [Math.max(0, Math.floor(low / 15) * 15), Math.ceil(high / 15) * 15];
}
export function timeTicks(from: number, to: number) {
  const step =
    [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400].find(
      (s) => (to - from) / s <= 4,
    ) ?? Math.ceil((to - from) / 86400 / 4) * 86400;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks.length >= 2 ? ticks : [from, to];
}
export function trendPoints(
  detail: Detail,
  from: number,
  to: number,
  paceRange: [number, number],
) {
  const source = intervals(detail);
  const groups: { from: number; to: number; data: typeof source }[] = [];
  for (const v of source) {
    if (v.hr === null) continue;
    const last = groups.at(-1);
    if (last && last.to === v.from) {
      last.to = v.to;
      last.data.push(v);
    } else groups.push({ from: v.from, to: v.to, data: [v] });
  }
  let groupIndex = 0,
    startIndex = 0;
  return chartPoints(detail, from, to).map((p) => {
    while (groupIndex < groups.length - 1 && groups[groupIndex].to < p.time) {
      groupIndex++;
      startIndex = 0;
    }
    const g = groups[groupIndex];
    let hrTrend: number | null = null;
    if (p.hr !== null && g && p.time >= g.from && p.time <= g.to) {
      const a = Math.max(p.time - 30, g.from),
        b = Math.min(p.time + 30, g.to);
      while (startIndex < g.data.length && g.data[startIndex].to <= a)
        startIndex++;
      const values: { value: number; weight: number }[] = [];
      for (let i = startIndex; i < g.data.length && g.data[i].from < b; i++) {
        const x = g.data[i];
        values.push({
          value: x.hr!,
          weight: Math.max(0, Math.min(b, x.to) - Math.max(a, x.from)),
        });
      }
      const sec = values.reduce((s, x) => s + x.weight, 0);
      if (sec >= 30 && sec / (b - a) >= 0.7) hrTrend = quantile(values, 0.5);
    }
    return {
      ...p,
      hrTrend,
      pace:
        p.pace !== null && (p.pace < paceRange[0] || p.pace > paceRange[1])
          ? null
          : p.pace,
    };
  });
}
export function nearest(points: Point[], time: number): number {
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 &&
    Math.abs(points[lo - 1].time - time) < Math.abs(points[lo].time - time)
    ? lo - 1
    : lo;
}
export function chartPoints(detail: Detail, from: number, to: number): Point[] {
  const pts = detail.points.filter((p) => p.time >= from && p.time <= to),
    keep = new Set<number>();
  if (pts.length <= 500) pts.forEach((_, i) => keep.add(i));
  else {
    // At most 30 buckets × 8 endpoints/extrema. Reserve room for gap boundaries.
    const step = Math.ceil(pts.length / 30);
    for (let a = 0; a < pts.length; a += step) {
      keep.add(a);
      keep.add(Math.min(pts.length - 1, a + step - 1));
      for (const key of METRICS) {
        let low = -1,
          high = -1;
        for (let i = a; i < Math.min(a + step, pts.length); i++) {
          const v = pts[i][key];
          if (v !== null) {
            if (low < 0 || v < pts[low][key]!) low = i;
            if (high < 0 || v > pts[high][key]!) high = i;
          }
        }
        if (low >= 0) keep.add(low);
        if (high >= 0) keep.add(high);
      }
    }
  }
  const indices = [...keep].sort((a, b) => a - b),
    result: Point[] = [];
  for (let j = 0; j < indices.length; j++) {
    const index = indices[j];
    if (j) {
      const prior = indices[j - 1],
        boundaries = new Set<number>();
      let gap = false;
      const found = new Set<Metric>();
      for (let k = prior + 1; k <= index; k++) {
        if (pts[k].time - pts[k - 1].time > detail.gapSec) gap = true;
        if (k < index)
          for (const key of METRICS) {
            if (pts[k][key] === null && !found.has(key)) {
              found.add(key);
              boundaries.add(k);
            }
          }
      }
      if (gap) {
        result.push({
          ...pts[prior],
          time: (pts[prior].time + pts[index].time) / 2,
          hr: null,
          pace: null,
          cadence: null,
        });
      } else {
        for (const k of [...boundaries].sort((a, b) => a - b))
          result.push(pts[k]);
      }
    }
    result.push(pts[index]);
  }
  return result;
}
