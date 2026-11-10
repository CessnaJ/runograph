import { describe, expect, it } from "vitest";
import { observedStats, profile } from "./metrics";
import { NIKE_LIMITS, parseNike, sniffNike } from "./nike";

const start = Date.UTC(2025, 9, 1, 23, 30);
const sample = (from: number, to: number, value: number) => ({
  start_epoch_ms: start + from * 1000,
  end_epoch_ms: start + to * 1000,
  value,
});
const run = (overrides: Record<string, unknown> = {}) => ({
  id: "synthetic-personal-id",
  type: "run",
  start_epoch_ms: start,
  end_epoch_ms: start + 1800 * 1000,
  active_duration_ms: 1700 * 1000,
  time_zone: "Asia/Seoul",
  summaries: [
    { metric: "distance", summary: "sum", unit: "KM", value: 5 },
    { metric: "heart_rate", summary: "mean", unit: "BPM", value: 150 },
    { metric: "heart_rate", summary: "max", unit: "BPM", value: 170 },
  ],
  ...overrides,
});
const parse = (data: unknown) => parseNike(JSON.stringify(data));

describe("Nike metric activity imports", () => {
  it("recognizes single activities, arrays and activity envelopes, not profile JSON", () => {
    const a = run();
    expect([a, [a], { activities: [a] }].every(sniffNike)).toBe(true);
    expect(sniffNike({ name: "Nike member", activity_count: 3 })).toBe(false);
    expect(sniffNike({ type: "run", date: "2025-10-01", distance: 5 })).toBe(
      false,
    );
    expect(() => parse({ profile: { type: "run" } })).toThrow("지원하는");
    expect(() => parseNike('{"activities":')).toThrow("JSON 형식");
  });

  it("uses explicit summary units and timezone without retaining account / route fields", () => {
    const { sessions, details, warnings } = parse(
      run({
        email: "synthetic@example.invalid",
        tags: { nickname: "Synthetic user", latitude: 37, longitude: 127 },
      }),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "nike-1",
      source: "nike",
      date: "2025-10-02",
      offsetMs: 9 * 60 * 60000,
      distanceM: 5000,
      durationMs: 1700000,
      meanHr: 150,
      maxHr: 170,
      status: "missing",
      detailAvailable: false,
      reference: null,
      uuid: null,
      deviceGroup: "출처 미상",
    });
    expect(details).toEqual([]);
    expect(warnings.join()).toContain("운동 요약");
    expect(JSON.stringify(sessions)).not.toMatch(
      /Synthetic|example|latitude|longitude|personal-id/,
    );
  });

  it("preserves explicitly timed measurements and converts speed, not mean pace, into samples", () => {
    const { sessions, details } = parse(
      run({
        metrics: [
          {
            type: "heart_rate",
            unit: "BPM",
            values: [sample(0, 10, 140), sample(10, 20, 160)],
          },
          {
            type: "speed",
            unit: "KM/H",
            values: [sample(0, 10, 9), sample(10, 20, 10.8)],
          },
          { type: "cadence", unit: "SPM", values: [sample(0, 20, 170)] },
        ],
      }),
    );
    expect(sessions[0]).toMatchObject({
      status: "pending",
      detailAvailable: true,
    });
    expect(details[0].id).toBe(sessions[0].id);
    expect(observedStats(details[0], 0, 20)).toMatchObject({
      meanHr: 150,
      hrSec: 20,
      speedSec: 20,
      meanSpeed: 2.75,
      meanCadence: 170,
    });
    expect(details[0].points[0]).toMatchObject({
      hr: 140,
      speed: 2.5,
      pace: 400,
      distance: null,
    });
  });

  it("does not extend measured heart rate through an explicit short gap", () => {
    const { details } = parse(
      run({
        metrics: [
          {
            type: "heart_rate",
            unit: "BPM",
            values: [sample(0, 10, 140), sample(30, 40, 160)],
          },
          { type: "speed", unit: "M/S", values: [sample(0, 40, 3)] },
        ],
      }),
    );
    expect(observedStats(details[0], 0, 40)).toMatchObject({
      meanHr: 150,
      hrSec: 20,
      speedSec: 40,
      meanSpeed: 3,
    });
  });

  it("leaves unknown units and absent heart rate empty instead of making pace / HR streams", () => {
    const { sessions, details, warnings } = parse(
      run({
        summaries: [
          { metric: "distance", summary: "sum", value: 5 },
          { metric: "heart_rate", summary: "mean", unit: "bpm", value: 0 },
        ],
        metrics: [
          { type: "speed", values: [sample(0, 10, 10)] },
          { type: "heart_rate", unit: "unknown", values: [sample(0, 10, 150)] },
          { type: "latitude", unit: "DEGREES", values: [sample(0, 10, 37)] },
          { type: "longitude", unit: "DEGREES", values: [sample(0, 10, 127)] },
        ],
      }),
    );
    expect(sessions[0]).toMatchObject({
      distanceM: null,
      meanHr: null,
      maxHr: null,
      detailAvailable: false,
    });
    expect(details).toEqual([]);
    expect(warnings.join()).toContain("단위");
  });

  it("marks uncertain date as UTC; accepts explicit UTC offsets and DST-aware IANA zones", () => {
    expect(parse(run({ time_zone: "invalid/zone" })).sessions[0]).toMatchObject(
      {
        date: "2025-10-01",
        offsetMs: null,
      },
    );
    expect(
      parse(run({ time_zone: undefined, utc_offset: "+09:00" })).sessions[0]
        .date,
    ).toBe("2025-10-02");
    expect(
      parse(run({ time_zone: "America/New_York" })).sessions[0].offsetMs,
    ).toBe(-4 * 60 * 60000);
    expect(
      parse(
        run({
          start_epoch_ms: Date.UTC(2025, 0, 1),
          end_epoch_ms: Date.UTC(2025, 0, 1, 0, 30),
          time_zone: "Europe/London",
        }),
      ).sessions[0].offsetMs,
    ).toBe(0);
    expect(
      parse(run({ time_zone: undefined, utc_offset: 32400000 })).sessions[0]
        .offsetMs,
    ).toBeNull();
  });

  it("omits conflicting overlapping measurements while preserving agreement", () => {
    const { sessions, details } = parse(
      run({
        metrics: [
          {
            type: "heart_rate",
            unit: "BPM",
            values: [sample(0, 20, 140), sample(10, 30, 160)],
          },
          {
            type: "speed",
            unit: "M/S",
            values: [sample(0, 30, 3), sample(0, 30, 3)],
          },
        ],
      }),
    );
    expect(sessions[0].issues).toContain("conflicting-points");
    expect(observedStats(details[0], 0, 30)).toMatchObject({
      meanHr: 150,
      hrSec: 20,
      speedSec: 30,
    });
  });

  it("does not turn invalid measurement timing or missing interval endpoints into continuous data", () => {
    const { sessions, details } = parse(
      run({
        metrics: [
          {
            type: "heart_rate",
            unit: "BPM",
            values: [
              sample(-10, 0, 140),
              sample(20, 10, 150),
              { start_epoch_ms: start, value: 160 },
              sample(1790, 1810, 170),
            ],
          },
        ],
      }),
    );
    expect(sessions[0].issues).toContain("nike-invalid-values");
    expect(details).toEqual([]);
  });

  it("sorts/remaps detail IDs, skips non-runs and deduplicates only identical source objects", () => {
    const first = run({
      metrics: [{ type: "speed", unit: "M/S", values: [sample(0, 10, 3)] }],
    });
    const later = run({
      start_epoch_ms: start + 86400000,
      end_epoch_ms: start + 86400000 + 10000,
    });
    const { sessions, details, warnings } = parse({
      activities: [first, first, run({ type: "cycle" }), later],
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].startMs).toBe(start + 86400000);
    expect(details[0].id).toBe("nike-2");
    expect(warnings.join()).toContain("한 번만");
  });

  it("does not pick an arbitrary conflicting summary or infer whole-run missing distance", () => {
    const { sessions } = parse(
      run({
        summaries: [
          { metric: "distance", summary: "sum", unit: "KM", value: 5 },
          { metric: "distance", summary: "sum", unit: "M", value: 6000 },
        ],
      }),
    );
    expect(sessions[0].distanceM).toBeNull();
    expect(sessions[0].issues).toContain("nike-summary-conflict");
  });

  it("accepts camelCase explicit millisecond fields and falls back only to known wall duration", () => {
    const { sessions } = parse({
      type: "jogging",
      startEpochMs: start,
      endEpochMs: start + 100000,
      utcOffset: "+0000",
      summaries: [{ metric: "distance", unit: "MI", value: 1 }],
    });
    expect(sessions[0]).toMatchObject({
      durationMs: 100000,
      distanceM: 1609.344,
      offsetMs: 0,
    });
  });

  it("fails clearly when no valid running records survive and bounds metric input size", () => {
    expect(() => parse(run({ start_epoch_ms: "invalid" }))).toThrow(
      "러닝 기록",
    );
    expect(() => parse(run({ end_epoch_ms: start - 1 }))).toThrow("러닝 기록");
    const original = NIKE_LIMITS.values;
    try {
      NIKE_LIMITS.values = 1;
      expect(() =>
        parse(
          run({
            metrics: [
              {
                type: "speed",
                unit: "M/S",
                values: [sample(0, 10, 3), sample(10, 20, 3)],
              },
            ],
          }),
        ),
      ).toThrow("100만 개");
    } finally {
      NIKE_LIMITS.values = original;
    }
  });

  it("preserves enough observed intervals for the existing review and stability analyses", () => {
    const values = Array.from({ length: 180 }, (_, i) =>
      sample(i * 10, (i + 1) * 10, 150),
    );
    const speeds = Array.from({ length: 180 }, (_, i) =>
      sample(i * 10, (i + 1) * 10, 3),
    );
    const { details } = parse(
      run({
        metrics: [
          { type: "heart_rate", unit: "BPM", values },
          { type: "speed", unit: "M/S", values: speeds },
        ],
      }),
    );
    const p = profile(details[0]);
    expect(p.hrSec).toBe(1800);
    expect(p.windows!.length).toBeGreaterThan(10);
    expect(p.stabilityVariants).toHaveLength(8);
    expect(p.review).toBeDefined();
  });
});
