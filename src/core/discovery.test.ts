import { describe, expect, it } from "vitest";
import {
  buildStableWindows,
  buildStabilityVariants,
  compare,
  STABILITY_DEFAULTS,
  suggestComparison,
  trainingRows,
  type CompareConfig,
} from "./analysis";
import { discoverComparison } from "./discovery";
import type { Detail, Profile, Summary } from "./types";

function summary(id: string, date: string): Summary {
  return {
    id,
    date,
    startMs: Date.parse(`${date}T00:00:00Z`),
    endMs: null,
    offsetMs: 0,
    durationMs: 1_800_000,
    distanceM: 4000,
    meanHr: 150,
    maxHr: 170,
    meanCadence: null,
    status: "ready",
    issues: [],
    deviceGroup: "기기 A",
  };
}

function detail(id: string, hr = 150): Detail {
  return {
    id,
    gapSec: 30,
    issues: [],
    distanceSemantics: "unknown",
    points: Array.from({ length: 181 }, (_, i) => ({
      time: i * 10,
      epochMs: i * 10_000,
      hr,
      speed: 2.4,
      pace: 1000 / 2.4,
      cadence: 170,
      distance: null,
    })),
  };
}

function profile(d: Detail, cache = true): Profile {
  return {
    id: d.id,
    hrSum: 0,
    hrSec: 1800,
    maxHr: null,
    bins: [],
    pairCount: 180,
    observations: [],
    drift: null,
    windows: buildStableWindows(d).windows,
    ...(cache ? { stabilityVariants: buildStabilityVariants(d) } : {}),
  };
}

function comparable(cache = true) {
  const sessions: Summary[] = [],
    profiles: Profile[] = [];
  for (let period = 0; period < 2; period++)
    for (let i = 0; i < 8; i++) {
      const id = `${period}-${i}`;
      sessions.push(
        summary(
          id,
          `2026-${period ? "02" : "01"}-${String(5 + i * 2).padStart(2, "0")}`,
        ),
      );
      profiles.push(profile(detail(id, period ? 145 : 150), cache));
    }
  const cfg: CompareConfig = {
    question: "heart",
    days: 28,
    anchor: "2026-02-25",
    target: 1000 / 2.4,
    device: "기기 A",
    phases: [1, 2, 3],
    width: 0.08,
    elapsedFrom: 300,
    elapsedTo: 1200,
  };
  return { sessions, profiles, cfg };
}

describe("cached stability sensitivity", () => {
  it("produces the same windows as all eight direct threshold calculations", () => {
    const d = detail("changing");
    d.points.forEach((p, i) => {
      p.speed = 2.4 * (1 + ((i % 6) - 2.5) * 0.025);
      if (i >= 80 && i < 90) p.hr = null;
      if (i >= 120 && i < 125) p.speed = 1.2;
    });
    const cached = buildStabilityVariants(d);
    expect(cached).toHaveLength(8);
    expect(cached.some((v) => v.context === 120 && v.cv === 0.08)).toBe(false);
    for (const variant of cached)
      expect(variant.windows).toEqual(
        buildStableWindows(d, {
          ...STABILITY_DEFAULTS,
          context: variant.context,
          cv: variant.cv,
        }).windows,
      );
    expect(STABILITY_DEFAULTS).toMatchObject({ context: 120, cv: 0.08 });
  });

  it("tests the same comparison config against cached thresholds and detects reversal", () => {
    const { sessions, profiles, cfg } = comparable();
    for (const p of profiles) {
      const variant = p.stabilityVariants!.find(
        (v) => v.context === 90 && v.cv === 0.08,
      )!;
      variant.windows = variant.windows.map((w) => ({
        ...w,
        hr: p.id.startsWith("1-") ? 160 : 150,
      }));
    }
    const result = compare(sessions, profiles, cfg);
    expect(result.baseState).toBe("ready");
    expect(result.state).toBe("sensitive");
    expect(result.sensitivity).toMatchObject({
      directionChanged: true,
      conditionsChanged: false,
      stabilityVariants: 8,
      bandwidthVariants: 2,
      leaveOneOutVariants: 16,
      variants: 26,
    });
    expect(result.sensitivity!.min).toBeCloseTo(-5);
    expect(result.sensitivity!.max).toBeCloseTo(10);
  });

  it("reports lost support separately from reversed direction and skips uncomputed caches", () => {
    const { sessions, profiles, cfg } = comparable();
    for (const p of profiles.filter((p) => p.id.startsWith("1-")))
      p.stabilityVariants!.find(
        (v) => v.context === 180 && v.cv === 0.05,
      )!.windows = [];
    const result = compare(sessions, profiles, cfg);
    expect(result.sensitivity).toMatchObject({
      directionChanged: false,
      conditionsChanged: true,
    });
    const old = comparable(false);
    expect(
      compare(old.sessions, old.profiles, old.cfg).sensitivity,
    ).toMatchObject({
      stabilityVariants: 0,
      variants: 18,
    });
    expect(compare(sessions.slice(0, 9), profiles, cfg).sensitivity).toBeNull();
  });

  it("does not label floating point noise from identical pace observations as a direction change", () => {
    const { sessions, profiles, cfg } = comparable();
    for (const p of profiles) {
      p.windows!.forEach((w) => {
        w.hr = 150;
      });
      p.stabilityVariants!.forEach((v) =>
        v.windows.forEach((w) => {
          w.hr = 150;
        }),
      );
    }
    const result = compare(sessions, profiles, {
      ...cfg,
      question: "pace",
      target: 150,
      width: 10,
    });
    expect(Math.abs(result.difference!)).toBeLessThan(1e-8);
    expect(result.state).toBe("ready");
    expect(result.sensitivity?.directionChanged).toBe(false);
  });
});

describe("automatic comparisons", () => {
  function sparseRecent() {
    const dates = [
      "2026-08-01",
      "2026-08-05",
      "2026-08-09",
      "2026-08-13",
      "2026-08-17",
      "2026-08-21",
      "2026-08-25",
      "2026-09-01",
      "2026-09-20",
      "2026-09-23",
      "2026-09-26",
      "2026-09-29",
      "2026-10-02",
      "2026-10-05",
      "2026-10-08",
      "2026-11-10",
    ];
    const sessions = dates.map((date, i) => summary(String(i), date));
    const profiles = sessions.map((s, i) => {
      const p = profile(detail(s.id, i < 8 ? 150 : 145));
      p.windows = p.windows!.filter((w) => w.from >= 600 && w.to <= 1500);
      p.stabilityVariants = p.stabilityVariants!.map((v) => ({
        ...v,
        windows: v.windows.filter((w) => w.from >= 600 && w.to <= 1500),
      }));
      return p;
    });
    return { sessions, profiles };
  }

  it("anchors to the latest known date even when it has no eligible stable windows", () => {
    const { sessions, profiles } = comparable();
    sessions.push({
      ...summary("latest", "2026-03-01"),
      growthExcluded: true,
      durationMs: 10_000,
    });
    sessions.push({ ...summary("unknown-zone", "2026-03-02"), offsetMs: null });
    expect(suggestComparison(sessions, profiles).anchor).toBe("2026-03-01");
    expect(discoverComparison(sessions, profiles).preferred.anchor).toBe(
      "2026-03-01",
    );
  });

  it("offers a clearly different period when the latest four weeks lack support", () => {
    const { sessions, profiles } = sparseRecent();
    const result = discoverComparison(sessions, profiles);
    expect(result.preferred).toMatchObject({
      days: 28,
      anchor: "2026-11-10",
      elapsedFrom: 300,
      elapsedTo: 1200,
    });
    expect(result.searched).toBe(6);
    expect(result.alternative?.config).toMatchObject({
      days: 56,
      anchor: "2026-11-10",
      elapsedFrom: 600,
      elapsedTo: 1500,
    });
    expect(result.alternative?.baseState).toBe("ready");
    expect(result.alternative?.previous.count).toBe(8);
    expect(result.alternative?.recent.count).toBe(8);
    expect(result.alternative?.sensitivity?.stabilityVariants).toBe(8);
  });

  it("ranks heart comparison conditions independently of response magnitude and direction", () => {
    const { sessions, profiles } = sparseRecent();
    const before = discoverComparison(sessions, profiles);
    const changed = profiles.map((p, i) => {
      const transform = (w: NonNullable<Profile["windows"]>[number]) => ({
        ...w,
        hr: i < 8 ? 130 : 190 + (w.from >= 1200 ? 30 : 0),
      });
      return {
        ...p,
        windows: p.windows!.map(transform),
        stabilityVariants: p.stabilityVariants!.map((v) => ({
          ...v,
          windows: v.windows.map(transform),
        })),
      };
    });
    const after = discoverComparison(sessions, changed);
    expect(after.preferred).toEqual(before.preferred);
    expect(after.alternative?.config).toEqual(before.alternative?.config);
    expect(before.alternative!.difference).toBeLessThan(0);
    expect(after.alternative!.difference).toBeGreaterThan(0);
  });

  it("ranks same-heart-rate pace conditions independently of observed speed changes", () => {
    const { sessions, profiles } = sparseRecent();
    const withResponse = (reverse: boolean) =>
      profiles.map((p, i) => {
        const transform = (w: NonNullable<Profile["windows"]>[number]) => ({
          ...w,
          hr: 150,
          speed: i < 8 ? 2.4 : reverse ? 2.1 : 2.7,
        });
        return {
          ...p,
          windows: p.windows!.map(transform),
          stabilityVariants: p.stabilityVariants!.map((v) => ({
            ...v,
            windows: v.windows.map(transform),
          })),
        };
      });
    const faster = discoverComparison(sessions, withResponse(false), "pace"),
      slower = discoverComparison(sessions, withResponse(true), "pace");
    expect(faster.preferred).toEqual(slower.preferred);
    expect(faster.alternative?.config).toEqual(slower.alternative?.config);
    expect(faster.alternative!.difference).toBeLessThan(0);
    expect(slower.alternative!.difference).toBeGreaterThan(0);
  });

  it("keeps an already supported preferred result and returns no fabricated Apple comparison", () => {
    const { sessions, profiles } = comparable();
    expect(discoverComparison(sessions, profiles)).toMatchObject({
      alternative: null,
      searched: 1,
    });
    const apple = sessions.map((s) => ({
      ...s,
      source: "apple" as const,
      status: "missing" as const,
    }));
    expect(discoverComparison(apple, [])).toMatchObject({
      alternative: null,
      searched: 6,
    });
  });
});

describe("training medians", () => {
  it("averages both central observations for two sessions without changing totals", () => {
    const sessions = [summary("a", "2026-11-10"), summary("b", "2026-11-10")];
    sessions[0].durationMs = 31.1 * 60_000;
    sessions[1].durationMs = 8.1 * 60_000;
    const profiles = sessions.map((s, i) => ({
      ...profile(detail(s.id), false),
      longestRunSec: (i ? 5 : 25) * 60,
    }));
    const [row] = trainingRows(sessions, profiles);
    expect(row.durationMedian).toBeCloseTo(19.6);
    expect(row.longestMedian).toBe(15);
    expect(row.minutes).toBeCloseTo(39.2);
  });
});
