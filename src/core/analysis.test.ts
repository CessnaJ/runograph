import { describe, expect, it } from "vitest";
import {
  buildStableWindows,
  compare,
  intervals,
  kernel,
  metricStats,
  primaryRange,
  suggestComparison,
  trainingRows,
  type CompareConfig,
} from "./analysis";
import { paceDomain, trendPoints } from "./chart";
import { aggregate, observedStats, profile } from "./metrics";
import { parseExerciseCsv } from "./parser";
import { qualityIssues, summaryPace } from "./quality";
import type { Detail, Profile, Summary } from "./types";
const speed = 1000 / 420;
function detail(hr = 150, step = 10): Detail {
  return {
    id: "s",
    gapSec: 30,
    distanceSemantics: "unknown",
    issues: [],
    points: Array.from({ length: 1200 / step + 1 }, (_, i) => ({
      time: i * step,
      epochMs: i * step * 1000,
      hr,
      speed,
      pace: 420,
      cadence: 170,
      distance: null,
    })),
  };
}
function summary(id = "s", date = "2026-02-10"): Summary {
  return {
    id,
    date,
    startMs: Date.parse(date + "T00:00:00Z"),
    endMs: Date.parse(date + "T00:00:00Z") + 1200000,
    offsetMs: 0,
    durationMs: 1200000,
    distanceM: speed * 1200,
    meanHr: 150,
    maxHr: 155,
    meanCadence: 170,
    status: "ready",
    issues: [],
    deviceGroup: "기기 A",
  };
}
function dataset() {
  const sessions: Summary[] = [],
    profiles: Profile[] = [];
  for (let period = 0; period < 2; period++)
    for (let i = 0; i < 8; i++) {
      const id = `${period}-${i}`,
        date = `2026-${period ? "02" : "01"}-${String(5 + i * 2).padStart(2, "0")}`;
      sessions.push(summary(id, date));
      const d = detail(period ? 145 : 150);
      d.id = id;
      profiles.push(profile(d));
    }
  const config: CompareConfig = {
    question: "heart",
    days: 28,
    anchor: "2026-02-25",
    target: 420,
    device: "기기 A",
    phases: [1, 2, 3],
    width: 0.08,
    elapsedFrom: 300,
    elapsedTo: 1200,
  };
  return { sessions, profiles, config };
}
describe("v0.2 interval and quality contracts", () => {
  it("clips intervals at arbitrary selection boundaries and includes leading missing time in coverage", () => {
    const d = detail();
    d.points[0].hr = 100;
    d.points[1].hr = 200;
    expect(metricStats(d, 5, 15, "hr").mean).toBe(150);
    expect(observedStats(d, 5, 15).meanHr).toBe(150);
    d.points = d.points.slice(1);
    expect(metricStats(d, 0, 20, "hr").coverage).toBe(0.5);
    expect(observedStats(d, 0, 20).coverage).toBe(0.5);
  });
  it("separates suspicious summary values from valid detail and preserves raw totals", () => {
    const s = { ...summary(), durationMs: 120000, distanceM: 4000 };
    const d = detail();
    s.quality = qualityIssues(s, d);
    expect(s.quality.map((q) => q.code)).toContain("summary-detail-speed");
    expect(summaryPace(s)).toBeNull();
    expect(aggregate([s], [profile(d)]).pace).toBeNull();
    expect(aggregate([s], [profile(d)], true).distanceM).toBe(4000);
    expect(profile(d).windows!.length).toBeGreaterThan(3);
  });
  it("allows a short split record to be included without making malformed fields valid", () => {
    const s = { ...summary(), durationMs: 30000, distanceM: 50 };
    s.quality = qualityIssues(s);
    expect(aggregate([s], []).distanceM).toBeNull();
    expect(aggregate([{ ...s, inclusion: "include" }], []).distanceM).toBe(50);
    expect(
      summaryPace({ ...s, distanceM: null, inclusion: "include" }),
    ).toBeNull();
  });
  it("focuses on the principal observations without deleting the remote tail", () => {
    const d = detail();
    d.points.push({ ...d.points.at(-1)!, time: 100000, epochMs: 100000000 });
    expect(primaryRange(d)).toEqual([0, 1200]);
    expect(d.points.at(-1)!.time).toBe(100000);
    expect(intervals(d).reduce((n, x) => n + x.sec, 0)).toBe(1200);
    expect(buildStableWindows(d).windows).toHaveLength(
      buildStableWindows(detail()).windows.length,
    );
  });
  it("keeps slow outliers readable while trend and display do not change source statistics", () => {
    const d = detail();
    d.points.at(-1)!.speed = 0.5;
    d.points.at(-1)!.pace = 2000;
    const original = structuredClone(d);
    const range = paceDomain(d, 0, 1200);
    expect(range[1]).toBeLessThan(600);
    expect(paceDomain(d, 0, 1200, true)[1]).toBeGreaterThan(2000);
    const displayed = trendPoints(d, 0, 1200, range);
    expect(displayed.at(-1)!.pace).toBeNull();
    expect(displayed.some((p) => p.hrTrend !== null)).toBe(true);
    expect(d).toEqual(original);
  });
  it("does not smooth or weight across a gap, missing HR or the last point", () => {
    const d = detail();
    d.points[60].hr = null;
    expect(
      intervals(d)
        .filter((x) => x.hr !== null)
        .reduce((s, x) => s + x.sec, 0),
    ).toBe(1180);
    expect(
      trendPoints(d, 0, 1200, [300, 600]).find((p) => p.time === 600)!.hrTrend,
    ).toBeNull();
  });
  it("uses local anonymous device groups and never labels an ID as a watch model", () => {
    const csv =
      "exercise_type,start_time,time_offset,duration,distance,deviceuuid\n1002,2026-01-01 00:00:00,UTC+0900,600000,1500,private-device-one\n1002,2026-01-02 00:00:00,UTC+0900,600000,1500,private-device-two\n1002,2026-01-03 00:00:00,UTC+0900,600000,1500,private-device-one";
    const s = parseExerciseCsv(csv).sessions;
    expect(s[0].deviceGroup).toBe(s[2].deviceGroup);
    expect(s[1].deviceGroup).not.toBe(s[0].deviceGroup);
    expect(JSON.stringify(s)).not.toContain("private-device");
  });
});
describe("stable observations and comparable periods", () => {
  it("uses actual time rather than sample density, keeps non-overlapping analysis windows", () => {
    const a = buildStableWindows(detail()),
      b = buildStableWindows(detail(150, 5));
    expect(a.windows.map((w) => [w.from, w.to, w.hr, w.sec])).toEqual(
      b.windows.map((w) => [w.from, w.to, w.hr, w.sec]),
    );
    a.windows.forEach((w, i) =>
      expect(w.speed).toBeCloseTo(b.windows[i].speed, 10),
    );
    expect(
      a.windows.every((w, i) => i === 0 || w.from >= a.windows[i - 1].to),
    ).toBe(true);
  });
  it("excludes speed transitions but does not exclude high HR alone", () => {
    const d = detail(250);
    expect(buildStableWindows(d).windows.length).toBeGreaterThan(0);
    d.points[65].speed = 1;
    expect(
      buildStableWindows(d).windows.some((w) => w.from <= 650 && w.to > 650),
    ).toBe(false);
    expect(buildStableWindows(d).windows.some((w) => w.from >= 900)).toBe(true);
  });
  it("finds a lower observed HR at the same speed, with correct independent run support", () => {
    const { sessions, profiles, config } = dataset(),
      c = compare(sessions, profiles, config);
    expect(c.state).toBe("ready");
    expect(c.difference).toBeCloseTo(-5);
    expect(c.previous.effective).toBeCloseTo(8);
    expect(c.previous.count).toBe(8);
    expect(c.periods.previous).toEqual(["2026-01-01", "2026-01-28"]);
    expect(c.periods.recent).toEqual(["2026-01-29", "2026-02-25"]);
  });
  it("does not let one run dominate when it contains more windows or denser samples", () => {
    const { sessions, profiles, config } = dataset();
    const baseline = compare(sessions, profiles, config, false);
    profiles[0] = {
      ...profiles[0],
      windows: profiles[0].windows!.flatMap((w) => [
        w,
        { ...w, samples: w.samples * 10 },
      ]),
    };
    const c = compare(sessions, profiles, config, false);
    expect(c.previous.value).toBeCloseTo(baseline.previous.value!);
    expect(c.previous.effective).toBeCloseTo(8);
  });
  it("reports mixed devices and data insufficiency instead of growth claims", () => {
    const { sessions, profiles, config } = dataset();
    expect(
      compare(sessions, profiles, { ...config, device: "all" }, false).state,
    ).toBe("conditions");
    expect(compare(sessions.slice(0, 9), profiles, config, false).state).toBe(
      "insufficient",
    );
    expect(
      compare(sessions, profiles, { ...config, target: 600 }, false).state,
    ).toBe("insufficient");
    expect(
      compare(
        sessions.map((s) => ({ ...s, offsetMs: null })),
        profiles,
        config,
        false,
      ).previous.count,
    ).toBe(0);
  });
  it("tapers continuously and freezes phase selection when the target changes", () => {
    expect(kernel(0.999)).toBeLessThan(0.000001);
    expect(kernel(1)).toBe(0);
    const { sessions, profiles, config } = dataset();
    profiles.forEach((p, i) =>
      p.windows!.forEach((w) => {
        w.speed = speed * (0.98 + (i % 8) * 0.005);
        w.hr += (i % 8) * 0.3;
      }),
    );
    const a = compare(sessions, profiles, config, false),
      b = compare(sessions, profiles, { ...config, target: 421 }, false);
    expect(Math.abs(a.previous.value! - b.previous.value!)).toBeLessThan(0.1);
    expect(a.config.phases).toEqual(b.config.phases);
  });
  it("selects targets from support, independent of the direction or magnitude of HR changes", () => {
    const { sessions, profiles } = dataset();
    const a = suggestComparison(sessions, profiles);
    const b = suggestComparison(
      sessions,
      profiles.map((p) => ({
        ...p,
        windows: p.windows!.map((w) => ({ ...w, hr: w.hr + 50 })),
      })),
    );
    expect(a.target).toBeCloseTo(b.target);
    expect(a.phases).toEqual(b.phases);
    expect(a.device).toBe(b.device);
  });
  it("keeps valid detail eligible and anchors to it when its summary values are held for review", () => {
    const { sessions, profiles, config } = dataset();
    const last = sessions.at(-1)!;
    last.durationMs = 120000;
    last.distanceM = 4000;
    last.quality = qualityIssues(last, detail());
    expect(summaryPace(last)).toBeNull();
    expect(compare(sessions, profiles, config, false).recent.count).toBe(8);
    expect(suggestComparison(sessions, profiles).anchor).toBe(last.date);
  });
  it("computes same-HR pace directly from speed instead of inverting the HR comparison", () => {
    const { sessions, profiles, config } = dataset();
    profiles.forEach((p, i) =>
      p.windows!.forEach((w) => {
        w.hr = 140;
        w.speed = i < 8 ? 2.3 : 2.4;
      }),
    );
    const c = compare(sessions, profiles, {
      ...config,
      question: "pace",
      target: 140,
      width: 10,
    });
    expect(c.state).toBe("ready");
    expect(c.previous.value).toBeCloseTo(1000 / 2.3);
    expect(c.difference).toBeCloseTo(1000 / 2.4 - 1000 / 2.3);
  });
  it("groups split activities by local day, skips unknown dates and marks empty weeks as records absent", () => {
    const a = summary("a", "2026-02-02"),
      b = summary("b", "2026-02-02"),
      c = summary("c", "2026-02-23"),
      u = { ...summary("u", "2026-02-24"), offsetMs: null };
    const rows = trainingRows([a, b, c, u], []);
    expect(rows[0].days).toBe(1);
    expect(rows[0].count).toBe(2);
    expect(rows[1].count).toBe(0);
    expect(rows[1].minutes).toBeNull();
    expect(rows.at(-1)!.partial).toBe(true);
  });
});
