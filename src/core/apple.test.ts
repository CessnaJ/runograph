import { expect, it } from "vitest";
import { AppleHealthParser, APPLE_LIMITS, appleDate } from "./apple";
import { Archive } from "./archive";
import { aggregate } from "./metrics";
import { summaryPace, usesSummary } from "./quality";
import {
  appleDocument,
  appleWorkout,
  appleXml,
  appleZip,
} from "../../tests/apple-fixture";

function parse(xml: string, chunkSize = 17) {
  const parser = new AppleHealthParser();
  for (let i = 0; i < xml.length; i += chunkSize)
    parser.write(xml.slice(i, i + chunkSize));
  return parser.finish();
}

it("streams legacy and statistics summaries, skips other activities and never fabricates detail", () => {
  const { sessions } = parse(appleXml());
  expect(sessions).toHaveLength(2);
  expect(sessions[0]).toMatchObject({
    source: "apple",
    date: "2026-01-03",
    startMs: Date.UTC(2026, 0, 3),
    durationMs: 2400000,
    distanceM: 6000,
    meanHr: 145,
    maxHr: 166,
    status: "missing",
    reference: null,
  });
  expect(sessions[1]).toMatchObject({
    date: "2026-01-01",
    distanceM: 5000,
    meanHr: null,
  });
  expect(summaryPace(sessions[0])).toBe(400);
  expect(aggregate(sessions, []).distanceM).toBe(11000);
  const result = JSON.stringify(sessions);
  for (const secret of ["PRIVATE", "Synthetic", "Watch", 'device"'])
    expect(result).not.toContain(secret);
});

it("validates calendar dates, explicit offsets and local date boundaries", () => {
  expect(appleDate("2026-01-01 00:15:00 +0900")).toEqual({
    ms: Date.UTC(2025, 11, 31, 15, 15),
    offsetMs: 32400000,
  });
  expect(appleDate("2026-01-01 23:15:00 -0730")?.ms).toBe(
    Date.UTC(2026, 0, 2, 6, 45),
  );
  for (const value of [
    "2026-02-30 09:00:00 +0900",
    "2026-01-01 25:00:00 +0900",
    "2026-01-01 09:00:00 +1460",
    "2026-01-01 09:00:00",
  ])
    expect(appleDate(value)).toBeNull();
  const result = parse(
    appleDocument(
      appleWorkout().replace("2026-01-01 09:00:00", "2026-02-30 09:00:00"),
    ),
  );
  expect(result.sessions).toEqual([]);
  expect(result.warnings[0]).toContain("1개");
});

it("normalizes explicit units, preserves paused duration, and does not infer unknown units", () => {
  const xml = appleDocument(
    appleWorkout(
      'totalDistance="3.1" totalDistanceUnit="mi"',
      '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="2.5" maximum="0" unit="count/s"/><WorkoutEvent type="HKWorkoutEventTypePause" date="2026-01-01 09:20:00 +0900"/>',
    ).replace(
      'duration="40" durationUnit="min"',
      'duration="1800" durationUnit="s"',
    ),
  );
  expect(parse(xml).sessions[0]).toMatchObject({
    distanceM: 3.1 * 1609.344,
    durationMs: 1800000,
    meanHr: 150,
    maxHr: null,
  });
  expect(
    parse(
      xml
        .replace('durationUnit="s"', 'durationUnit="unknown"')
        .replace('totalDistanceUnit="mi"', 'totalDistanceUnit="unknown"'),
    ).sessions[0],
  ).toMatchObject({ distanceM: null, durationMs: null });
});

it("keeps conflicting or missing summary values unavailable instead of substituting zero", () => {
  const body = appleWorkout(
    'totalDistance="5" totalDistanceUnit="km"',
    '<WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="6" unit="km"/>',
  );
  expect(parse(appleDocument(body)).sessions[0].distanceM).toBeNull();
  const conflict = appleWorkout(
    "",
    '<WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="140" unit="count/min"/><WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="150" unit="count/min"/>',
  );
  expect(parse(appleDocument(conflict)).sessions[0].meanHr).toBeNull();
  expect(
    parse(
      appleDocument(appleWorkout('totalDistance="-5" totalDistanceUnit="km"')),
    ).sessions[0].distanceM,
  ).toBeNull();
});

it("deduplicates exact known-source copies and holds overlapping runs out of totals", () => {
  const run = appleWorkout('totalDistance="5" totalDistanceUnit="km"');
  const same = parse(appleDocument(run + run));
  expect(same.sessions).toHaveLength(1);
  expect(same.warnings[0]).toContain("중복");
  const result = parse(
    appleDocument(
      run + run.replace("Synthetic Runner’s Watch", "Different app"),
    ),
  );
  expect(result.sessions).toHaveLength(2);
  expect(result.sessions.every((s) => !usesSummary(s, "distance"))).toBe(true);
  result.sessions[0].inclusion = "include";
  expect(aggregate(result.sessions, []).distanceM).toBe(5000);
});

it("rejects malformed XML, wrong roots, custom entities and oversized unfinished tokens", () => {
  for (const xml of [
    "<HealthData><Workout></HealthData>",
    "<Other/>",
    '<!DOCTYPE HealthData SYSTEM "https://example.com"><HealthData/>',
    '<!DOCTYPE HealthData [<!ENTITY x "SECRET">]><HealthData/>',
    '<HealthData locale="&unknown;"/>',
  ])
    expect(() => parse(xml)).toThrow();
  expect(() =>
    parse('<HealthData x="' + "a".repeat(APPLE_LIMITS.token + 32768), 16384),
  ).toThrow(/제한/);
  expect(() => parse("<HealthData>" + "<Nested>".repeat(33))).toThrow();
});

it("reads both ZIP and standalone XML locally and rejects detail as unsupported", async () => {
  for (const file of [await appleZip(), new Blob([appleXml()])]) {
    const result = await Archive.open(file, () => {});
    expect(result.archive.source).toBe("apple");
    expect(result.sessions).toHaveLength(2);
    await expect(result.archive.detail(result.sessions[0])).rejects.toThrow(
      /요약만 지원/,
    );
    await result.archive.close();
  }
});

it("aborts XML reads and enforces the expanded XML size limit", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    Archive.open(new Blob([appleXml()]), () => {}, controller.signal),
  ).rejects.toThrow();
  const blob = new Blob([appleXml()]);
  Object.defineProperty(blob, "size", { value: APPLE_LIMITS.xml + 1 });
  await expect(Archive.open(blob, () => {})).rejects.toThrow(/크기 제한/);
});
