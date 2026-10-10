import { describe, expect, it } from "vitest";
import { pairedStats, recap, runPair } from "./review";
import type { Detail } from "./types";

function recording(end = 1800, step = 10, hr = 140, speed = 2.5): Detail {
  return {
    id: "run",
    gapSec: 30,
    distanceSemantics: "unknown",
    issues: [],
    points: Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => ({
      time: i * step,
      epochMs: i * step * 1000,
      hr,
      speed,
      pace: speed ? 1000 / speed : null,
      cadence: null,
      distance: null,
    })),
  };
}
describe("explicit two-run review", () => {
  it("compares the same elapsed window despite different total lengths and sampling rates", () => {
    const pair = runPair(
      recording(2400, 10, 140, 2.5),
      recording(960, 5, 150, 2),
    );
    expect(pair).toMatchObject({
      from: 300,
      to: 960,
      current: { hr: 140, pace: 400, coverage: 1 },
      previous: { hr: 150, pace: 500, coverage: 1 },
    });
    expect(pair?.rows).toHaveLength(11);
  });
  it("keeps missing time in the denominator and requires jointly observed metrics", () => {
    const d = recording(1200);
    d.points = d.points.filter((p) => p.time <= 500 || p.time >= 1000);
    expect(pairedStats(d, 300, 1200)).toMatchObject({
      sec: 400,
      hr: null,
      pace: null,
    });
    const missingHr = recording(1200);
    missingHr.points.forEach((p) => {
      if (p.time >= 500) p.hr = null;
    });
    expect(pairedStats(missingHr, 300, 1200).pace).toBeNull();
  });
  it("clips interval boundaries without extending the last observation", () => {
    expect(pairedStats(recording(1200), 305, 605)).toMatchObject({
      sec: 300,
      hr: 140,
      pace: 400,
    });
    expect(pairedStats(recording(1200), 1195, 1220)).toMatchObject({
      sec: 5,
      hr: null,
      pace: null,
    });
  });
  it("does not produce a recap for stopped or insufficient recordings", () => {
    expect(runPair(recording(590), recording())).toBeNull();
    expect(pairedStats(recording(1200, 10, 140, 0), 300, 1200).pace).toBeNull();
    expect(recap(null)).toBeNull();
    expect(
      recap({
        from: 300,
        to: 1500,
        first: { speed: 0, hr: 140, sec: 600, coverage: 1 },
        last: { speed: 0, hr: 140, sec: 600, coverage: 1 },
        speedDifference: 0,
      }),
    ).toBeNull();
  });
});
