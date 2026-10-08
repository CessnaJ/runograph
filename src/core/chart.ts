import type { Detail, Point } from "./types";
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
  return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
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
