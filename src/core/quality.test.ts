import { describe, expect, it } from "vitest";
import { qualityIssues, usesSummary, summaryPace } from "./quality";
import { movementSegments } from "./metrics";
import type { Detail, Summary } from "./types";

const summary: Summary = {
  id: "run",
  date: "2026-01-01",
  startMs: 0,
  endMs: 1200000,
  durationMs: 1200000,
  distanceM: 3000,
  meanHr: 140,
  maxHr: 150,
  meanCadence: null,
  status: "ready",
  offsetMs: 0,
  issues: [],
};
function detail(speed = 2): Detail {
  return {
    id: "run",
    gapSec: 30,
    distanceSemantics: "interval",
    issues: [],
    points: Array.from({ length: 121 }, (_, i) => ({
      time: i * 10,
      epochMs: i * 10000,
      hr: 140,
      speed,
      pace: 1000 / speed,
      cadence: null,
      distance: null,
    })),
  };
}

describe("source explanations and measured movement", () => {
  it("explains a sufficiently observed source discrepancy without excluding summary values", () => {
    const s = { ...summary, quality: qualityIssues(summary, detail()) };
    expect(s.quality).toContainEqual(
      expect.objectContaining({
        code: "summary-detail-average",
        action: "notice",
      }),
    );
    expect(usesSummary(s, "pace")).toBe(true);
    expect(summaryPace(s)).toBe(400);
  });
  it("does not infer a source discrepancy when most speed observations are missing", () => {
    const d = detail();
    d.points = d.points.filter((p) => p.time <= 100 || p.time >= 1100);
    expect(
      qualityIssues(summary, d).some(
        (q) => q.code === "summary-detail-average",
      ),
    ).toBe(false);
  });
  it("keeps observed brief walking distinct from missing speed", () => {
    const d = detail(2.5);
    d.points[3].speed = 1.5;
    d.points[8].speed = null;
    const segments = movementSegments(d);
    expect(segments).toContainEqual({ from: 30, to: 40, state: "걷기 추정" });
    expect(segments).toContainEqual({ from: 70, to: 90, state: "미측정" });
  });
});
