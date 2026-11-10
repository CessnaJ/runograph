import { describe, expect, it } from "vitest";
import { buildPastReference, suggestSimilarRuns, summarizeRun } from "./runReview";
import type { Detail, Profile, Summary } from "./types";

function recording(id = "current", end = 1800, hr: number | null = 140, speed = 2.5): Detail {
  return { id, gapSec: 30, distanceSemantics: "unknown", issues: [],
    points: Array.from({ length: Math.floor(end / 10) + 1 }, (_, i) => ({
      time: i * 10, epochMs: i * 10000, hr, speed, pace: speed ? 1000 / speed : null,
      cadence: null, distance: null,
    })) };
}
function summary(id = "current", date = "2026-11-10", overrides: Partial<Summary> = {}): Summary {
  const startMs = Date.parse(date + "T00:00:00Z");
  return { id, date, source: "samsung", startMs, endMs: startMs + 1800000,
    offsetMs: 0, durationMs: 1800000, distanceM: 4500,
    meanHr: 140, maxHr: 150, meanCadence: null, status: "ready", issues: [],
    deviceGroup: "기기 A", ...overrides };
}
function profile(d: Detail): Profile {
  return { id: d.id, hrSum: 0, hrSec: 0, maxHr: null, bins: [], pairCount: 0,
    observations: [], drift: null, review: summarizeRun(d) };
}

describe("compact run review", () => {
  it("weights actual intervals and keeps independently observed speed without heart rate", () => {
    const d = recording("current", 20, null);
    d.points[1].time = 5;
    d.points[1].speed = 4;
    const r = summarizeRun(d);
    expect(r.hrCoverage).toBe(0);
    expect(r.speedCoverage).toBe(1);
    expect(r.bins[0].hr).toBeNull();
    expect(r.bins[0].pace).toBeCloseTo(1000 / ((2.5 * 5 + 4 * 15) / 20));
    expect(r.movement.runningSec).toBe(20);
  });
  it("leaves sensor gaps empty and does not extend a last sample", () => {
    const d = recording("current", 1200);
    d.points = d.points.filter((p) => p.time <= 500 || p.time >= 1000);
    const r = summarizeRun(d);
    expect(r.speedCoverage).toBeCloseTo(700 / 1200);
    expect(r.movement.unknownSec).toBe(500);
    expect(r.bins.some((b) => b.from >= 500 && b.to <= 1000 && b.pace === null)).toBe(true);
    expect(r.comparison.pairedCoverage).toBeCloseTo(400 / 900);
    expect(r.comparisonBins.at(-1)?.to).toBe(1200);
  });
  it("recognizes a sustained final three-minute acceleration even without heart rate", () => {
    const d = recording("current", 1800, null);
    for (const p of d.points) if (p.time >= 1620) p.speed = 3.1;
    const r = summarizeRun(d);
    expect(r.finish).toMatchObject({ accelerated: true, beforeSteady: true,
      before: { from: 1320, to: 1620, pace: 400 }, last: { from: 1620, to: 1800, hr: null } });
    expect(r.finish?.last.pace).toBeCloseTo(1000 / 3.1);
  });
  it("does not let a final spike, sparse ending or small increase become an acceleration story", () => {
    const spike = recording();
    for (const p of spike.points) if (p.time >= 1770) p.speed = 10;
    expect(summarizeRun(spike).finish?.accelerated).toBe(false);
    const sparse = recording();
    sparse.points = sparse.points.filter((p) => p.time <= 1660 || p.time >= 1760);
    for (const p of sparse.points) if (p.time >= 1620) p.speed = 3.1;
    expect(summarizeRun(sparse).finish?.accelerated).toBe(false);
    const minor = recording();
    for (const p of minor.points) if (p.time >= 1620) p.speed = 2.7;
    expect(summarizeRun(minor).finish?.accelerated).toBe(false);
    expect(summarizeRun(recording("short", 770)).finish).toBeNull();
  });
  it("recognizes acceleration supported by the last two minutes but rejects a cooldown finish", () => {
    const d = recording();
    for (const p of d.points) if (p.time >= 1680) p.speed = 3.5;
    expect(summarizeRun(d).finish?.accelerated).toBe(true);
    for (const p of d.points) if (p.time >= 1740) p.speed = 2.5;
    expect(summarizeRun(d).finish?.accelerated).toBe(false);
  });
  it("caps work and output when the recording contains a years-long gap", () => {
    const d = recording("current", 0);
    d.points.push({ ...d.points[0], time: 1000000000 });
    const r = summarizeRun(d);
    expect(r.bins.length).toBeLessThanOrEqual(60);
    expect(r.speedCoverage).toBe(0);
    expect(r.movement.unknownSec).toBe(1000000000);
  });
});

describe("similar runs without selecting heart-rate outcomes", () => {
  it("ranks using pace, duration and recency and keeps at most three candidates", () => {
    const current = summary();
    const past = [summary("a", "2026-11-09"), summary("b", "2026-11-08"), summary("c", "2026-11-07"), summary("d", "2026-11-06")];
    const sessions = [current, ...past];
    const profiles = [profile(recording()), ...past.map((s, i) => profile(recording(s.id, 1800, 110 + i * 30)))];
    const first = suggestSimilarRuns(current, sessions, profiles);
    expect(first.map((r) => r.id)).toEqual(["a", "b", "c"]);
    for (const p of profiles) { p.review!.comparison.hr = 250 - p.review!.comparison.hr!; }
    expect(suggestSimilarRuns(current, sessions, profiles)).toEqual(first);
  });
  it("requires known matching device/source, older date, 56-day recency, valid duration and fixed-window coverage", () => {
    const current = summary();
    const invalid = [
      summary("same-day"), summary("future", "2026-11-11"), summary("old", "2026-09-14"),
      summary("unknown", "2026-11-09", { deviceGroup: "출처 미상" }),
      summary("different", "2026-11-09", { deviceGroup: "기기 B" }),
      summary("apple", "2026-11-09", { source: "apple" }),
      summary("excluded", "2026-11-09", { growthExcluded: true }),
      summary("manual-excluded", "2026-11-09", { inclusion: "exclude" }),
      summary("invalid-time", "2026-11-09", { issues: ["duration-conflict"] }),
      summary("long", "2026-11-09", { durationMs: 2430001 }),
      summary("short-detail", "2026-11-09"), summary("fast", "2026-11-09"),
    ];
    const profiles = [profile(recording()), ...invalid.map((s) => profile(recording(s.id, s.id === "short-detail" ? 1000 : 1800, 140, s.id === "fast" ? 3 : 2.5)))];
    expect(suggestSimilarRuns(current, [current, ...invalid], profiles)).toEqual([]);
    expect(suggestSimilarRuns({ ...current, deviceGroup: "출처 미상" }, [current], profiles)).toEqual([]);
    expect(suggestSimilarRuns({ ...current, source: "apple" }, [current], profiles)).toEqual([]);
  });
  it("uses fixed 5–20 minute pace rather than the final acceleration or overall summary pace", () => {
    const current = summary("current", "2026-11-10", { distanceM: 8000 });
    const candidate = summary("prior", "2026-11-09", { distanceM: 3000 });
    const d = recording();
    for (const p of d.points) if (p.time >= 1500) p.speed = 5;
    const result = suggestSimilarRuns(current, [current, candidate], [profile(d), profile(recording("prior"))]);
    expect(result[0]?.id).toBe("prior");
    expect(result[0]?.pace).toBe(400);
  });
});

describe("personal past reference", () => {
  function fixture(count: number) {
    const current = summary();
    const past = Array.from({ length: count }, (_, i) => summary(`past${i}`, `2026-11-${String(9 - i).padStart(2, "0")}`));
    return { current, sessions: [current, ...past], profiles: [profile(recording("current", 1800, 180)), ...past.map((s, i) => profile(recording(s.id, 1800, 130 + i * 10)))] };
  }
  it("requires five distinct past dates and excludes the current run from the range", () => {
    const short = fixture(4);
    expect(buildPastReference(short.current, short.sessions, short.profiles)).toBeNull();
    const f = fixture(5);
    const result = buildPastReference(f.current, f.sessions, f.profiles);
    expect(result?.dates).toBe(5);
    expect(result?.bins[0]).toMatchObject({ currentHr: 180, low: 140, median: 150, high: 160, count: 5 });
    const duplicated = { ...f.sessions[1], id: "duplicate" };
    expect(buildPastReference(f.current, [...f.sessions.slice(0, 5), duplicated], [...f.profiles, profile(recording("duplicate"))])).toBeNull();
  });
  it("leaves insufficient individual minutes empty instead of bridging or extrapolating the band", () => {
    const f = fixture(5);
    const missing = recording("past0", 1800, 130);
    missing.points = missing.points.filter((p) => p.time <= 600 || p.time >= 660);
    f.profiles[1] = profile(missing);
    const result = buildPastReference(f.current, f.sessions, f.profiles);
    expect(result?.bins.find((b) => b.from === 540)?.low).not.toBeNull();
    expect(result?.bins.find((b) => b.from === 600)).toMatchObject({ low: null, high: null, count: 4 });
    expect(result?.bins.find((b) => b.from === 660)?.low).not.toBeNull();
    expect(result?.bins.every((b) => b.from >= 300 && b.to <= 1200)).toBe(true);
  });
  it("conditions every minute on similar input pace without selecting the heart-rate outcome", () => {
    const f = fixture(5);
    const varied = recording("past0", 1800, 130);
    for (const p of varied.points) if (p.time >= 600 && p.time < 660) p.speed = 3;
    f.profiles[1] = profile(varied);
    expect(buildPastReference(f.current, f.sessions, f.profiles)?.bins.find((b) => b.from === 600)?.low).toBeNull();
  });
});
