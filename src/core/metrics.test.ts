import { describe, expect, it } from "vitest";
import {
  aggregate,
  baselineObservations,
  driftAnalysis,
  growthRows,
  observedStats,
  observations,
  pairedSamples,
  periodGrowth,
  profile,
} from "./metrics";
import { chartPoints, domain, nearest } from "./chart";
import type { Detail, Point, Summary } from "./types";
const p = (
  time: number,
  hr: number | null = 120,
  speed: number | null = 2.5,
): Point => ({
  time,
  epochMs: time * 1000,
  hr,
  speed,
  pace: speed && speed > 0 ? 1000 / speed : null,
  cadence: 170,
  distance: 25,
});
const d = (points: Point[]): Detail => ({
  id: "test",
  points,
  gapSec: 30,
  distanceSemantics: "interval",
  issues: [],
});
const s = (
  id: string,
  durationMs: number | null,
  distanceM: number | null,
): Summary => ({
  id,
  date: "2026-01-01",
  startMs: 0,
  endMs: null,
  offsetMs: 0,
  durationMs,
  distanceM,
  meanHr: 120,
  maxHr: 150,
  meanCadence: null,
  status: "ready",
  issues: [],
});
describe("evidence-based calculations", () => {
  it("uses the same session set for weighted total pace", () => {
    const a = aggregate(
      [s("a", 600000, 1000), s("b", 600000, 2000), s("c", 600000, null)],
      [],
    );
    expect(a.pace).toBe(400);
    expect(a.medianPace).toBe(450);
    expect(a.durationMs).toBe(1800000);
    expect(a.meanHr).toBeNull();
  });
  it("weights real intervals and never extends missing/tail or a long gap", () => {
    const result = observedStats(
      d([p(0, 100), p(10, 140), p(20, null), p(100, 200), p(110, 180)]),
    );
    expect(result.hrSec).toBe(20);
    expect(result.meanHr).toBe(150);
    expect(result.samples).toBe(5);
  });
  it("excludes first five minutes, stationary/abrupt and missing pairs", () => {
    const pairs = pairedSamples(
      d([
        p(290),
        p(300),
        p(310, null),
        p(320),
        p(330, 120, 0),
        p(340),
        p(350),
        p(360),
      ]),
    );
    expect(pairs.map((x) => x.time)).toEqual([340, 350]);
  });
  it("does not invent growth values when minimum evidence is missing", () => {
    const detail = d(Array.from({ length: 10 }, (_, i) => p(300 + i * 10)));
    const rows = growthRows([s("test", 100000, 250)], [profile(detail)], 400);
    expect(rows[0].eligible).toBe(false);
    expect(periodGrowth(rows, "month")).toHaveLength(0);
  });
  it("weights each run equally for period medians and shows insufficient counts", () => {
    const rows = [
      {
        id: "a",
        date: "2026-01-01",
        hr: 100,
        samples: 100,
        sec: 1000,
        coverage: 1,
        eligible: true,
      },
      {
        id: "b",
        date: "2026-01-02",
        hr: 140,
        samples: 20,
        sec: 200,
        coverage: 1,
        eligible: true,
      },
    ];
    expect(periodGrowth(rows, "month")[0]).toMatchObject({
      hr: 120,
      sessions: 2,
      eligible: false,
    });
  });
  it("never computes personal baseline scores with zero MAD", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      date: "2026-01-0" + (i + 1),
      hr: i === 6 ? 180 : 120,
      samples: 30,
      sec: 300,
      coverage: 1,
      eligible: true,
    }));
    expect(baselineObservations(rows)).toHaveLength(0);
  });
  it("requires continuous stable 20 minutes for drift", () => {
    const detail = d(
      Array.from({ length: 152 }, (_, i) => p(i * 10, 120, 2.5)),
    );
    expect(driftAnalysis(detail, pairedSamples(detail))?.percent).toBe(0);
    const broken = d(
      detail.points.map((v, i) => (i === 85 ? { ...v, hr: null } : v)),
    );
    expect(driftAnalysis(broken, pairedSamples(broken))).toBeNull();
  });
  it("never reports correlation on constant data, and threshold ignores gaps", () => {
    const detail = d(Array.from({ length: 40 }, (_, i) => p(i * 10, 170, 2.5)));
    expect(
      observations(detail).filter((x) => x.kind === "similarity"),
    ).toHaveLength(0);
    expect(
      observations(
        d([p(0, 180), p(10, 180), p(100, 180), p(110, 180)]),
        170,
      ).filter((o) => o.kind === "threshold"),
    ).toHaveLength(0);
  });
  it("preserves peaks and breaks display lines, without modifying source or scale", () => {
    const points = Array.from({ length: 3000 }, (_, i) => p(i * 10, 120));
    points[1234].hr = 220;
    points[1700].hr = null;
    const detail = d(points);
    const full = chartPoints(detail, 0, 29990);
    expect(full.some((p) => p.hr === 220)).toBe(true);
    expect(full.some((p) => p.hr === null)).toBe(true);
    expect(points).toHaveLength(3000);
    expect(domain(points, "hr")).toEqual(domain(detail.points, "hr"));
    expect(nearest(points, 12341)).toBe(1234);
  });
});
it("preserves a peak after a missing value in the same display bucket", () => {
  const points = Array.from({ length: 3000 }, (_, i) => p(i, 120));
  points[1416].hr = null;
  points[1420].hr = 240;
  expect(chartPoints(d(points), 0, 2999).some((p) => p.hr === 240)).toBe(true);
});
it("rejects deeply nested JSON before parsing unneeded structures", async () => {
  const { parseDetail } = await import("./parser");
  expect(() =>
    parseDetail("[".repeat(17) + "0" + "]".repeat(17), {
      id: "test",
      startMs: 0,
      endMs: null,
      distanceM: null,
    }),
  ).toThrow(/구조.*제한/);
});
it("splits drift intervals exactly at the half-time boundary", () => {
  const detail = d(
    Array.from({ length: 302 }, (_, i) => p(i * 7, i < 172 ? 120 : 125, 2.5)),
  );
  const drift = driftAnalysis(detail, pairedSamples(detail));
  expect(drift).not.toBeNull();
  expect(drift!.percent).toBeGreaterThan(0);
  expect(drift!.coverage).toBe(1);
});
it("bounds display points and only inserts blank markers at unobserved times", () => {
  const points = Array.from({ length: 3000 }, (_, i) => ({
    ...p(i * 10, 120 + (i % 9)),
    pace: 400 + (i % 12),
    cadence: i % 7 ? 170 + (i % 5) : null,
  }));
  for (let i = 1; i < points.length; i += 5) points[i].hr = null;
  const output = chartPoints(d(points), 0, 29990);
  expect(output.length).toBeLessThanOrEqual(1000);
  const byTime = new Map(points.map((p) => [p.time, p]));
  for (const q of output) {
    if (byTime.has(q.time)) expect(q).toEqual(byTime.get(q.time));
    else expect([q.hr, q.pace, q.cadence]).toEqual([null, null, null]);
  }
});
it("never turns entirely missing totals into zero observations", () => {
  const result = aggregate([{ ...s("test", null, null), maxHr: null }], []);
  expect(result.distanceM).toBeNull();
  expect(result.durationMs).toBeNull();
  expect(result.maxHr).toBeNull();
  expect(result.distanceMissing).toBe(1);
  expect(aggregate([s("zero", 0, 0)], []).distanceM).toBeNull();
  expect(aggregate([s("zero", 0, 0)], [], true).distanceM).toBe(0);
});
