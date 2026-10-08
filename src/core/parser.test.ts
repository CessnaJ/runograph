import { describe, expect, it } from "vitest";
import {
  distanceSemantics,
  numeric,
  parseDetail,
  parseExerciseCsv,
  parseOffset,
  parseUtc,
} from "./parser";
import type { Point } from "./types";
const base = Date.UTC(2026, 0, 1, 18);
const summary = {
  id: "test",
  startMs: base,
  endMs: base + 100000,
  distanceM: 100,
};
function csv(
  rows: string,
  header = "exercise_type,start_time,time_offset,duration,distance,live_data,datauuid,update_time",
) {
  return `\uFEFFcom.samsung.shealth.exercise,7006011,18\r\n${header}\r\n${rows}`;
}
const row =
  "1002,2026-01-01 18:00:00,UTC+0900,100000,100,one.json,uuid,2026-01-01 19:00:00";
describe("defensive Samsung export parsing", () => {
  it("handles metadata, trailing blank, running type and local date without applying offset twice", () => {
    const result = parseExerciseCsv(
      csv(row + ",\r\n" + row.replace("1002", "1001")),
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      startMs: base,
      date: "2026-01-02",
      durationMs: 100000,
      distanceM: 100,
      reference: "one.json",
    });
  });
  it("rejects meaningful extra columns and invalid calendar dates", () => {
    expect(parseExerciseCsv(csv(row + ",secret")).sessions).toHaveLength(0);
    expect(parseUtc("2026-02-30 00:00:00")).toBeNull();
    expect(parseUtc("2026-01-01 24:00:00")).toBeNull();
  });
  it("parses only explicit timezone formats and avoids device-local dates", () => {
    expect(parseUtc("2026-01-01T18:00:00Z")).toBe(base);
    expect(parseUtc("2026-01-02T03:00:00+09:00")).toBe(base);
    expect(parseUtc("2026-01-01 18:00:00.123456")).toBe(base + 123);
    expect(parseOffset("UTC+0900")).toBe(9 * 3600000);
    expect(parseOffset("-03:30")).toBe(-3.5 * 3600000);
    expect(parseOffset("UTC+1460")).toBeNull();
    expect(parseOffset(32400000)).toBeNull();
  });
  it("marks alias conflicts rather than silently choosing", () => {
    const parsed = parseExerciseCsv(
      csv(
        "1002,2026-01-01 18:00:00,100,200",
        "exercise_type,start_time,distance,com.samsung.health.exercise.distance",
      ),
    );
    expect(parsed.sessions[0].distanceM).toBeNull();
    expect(parsed.sessions[0].issues).toContain("alias-conflict:distance");
  });
  it("chooses the newest duplicate UUID", () => {
    const result = parseExerciseCsv(
      csv(
        row +
          "\r\n" +
          row.replace(",100,", ",120,").replace("19:00:00", "20:00:00"),
      ),
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].distanceM).toBe(120);
  });
  it("keeps stationary zero, excludes null/nonfinite/negative, and does not erase high HR", () => {
    expect(numeric("")).toBeNull();
    expect(numeric("-1")).toBeNull();
    expect(numeric("Infinity")).toBeNull();
    const d = parseDetail(
      JSON.stringify([
        { start_time: base, heart_rate: 250, speed: 0 },
        { start_time: base + 10000, heart_rate: 0 },
      ]),
      summary,
    );
    expect(d.points[0]).toMatchObject({ hr: 250, speed: 0, pace: null });
    expect(d.points[1].hr).toBeNull();
  });
  it("merges complements but never sums conflicting duplicates, including later copies", () => {
    const d = parseDetail(
      JSON.stringify([
        { start_time: base, heart_rate: 120, distance: 10 },
        { start_time: base, cadence: 170, distance: 10 },
        { start_time: base, heart_rate: 140, distance: 20 },
        { start_time: base, heart_rate: 120, distance: 10 },
      ]),
      summary,
    );
    expect(d.points).toHaveLength(1);
    expect(d.points[0]).toMatchObject({
      hr: null,
      distance: null,
      cadence: 170,
    });
    expect(d.issues).toContain("conflicting-points");
  });
  it("rejects unsupported root and out of session points", () => {
    expect(() => parseDetail("{}", summary)).toThrow();
    expect(() =>
      parseDetail(JSON.stringify([{ start_time: base + 999999 }]), summary),
    ).toThrow();
  });
  it("distinguishes interval, cumulative, unknown and ambiguous distances", () => {
    const pts = (dist: number[]) =>
      dist.map((distance) => ({ distance })) as Point[];
    expect(distanceSemantics(pts([30, 20, 50]), 100)).toBe("interval");
    expect(distanceSemantics(pts([10, 40, 100]), 100)).toBe("cumulative");
    expect(distanceSemantics(pts([20, 30]), 100)).toBe("unknown");
    expect(distanceSemantics(pts([0, 100]), 100)).toBe("unknown");
  });
});
