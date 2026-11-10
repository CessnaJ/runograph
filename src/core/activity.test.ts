import { Encoder, Profile } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  FileIdMesg,
  RecordMesg,
  EventMesg,
  SessionMesg,
} from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { ACTIVITY_LIMITS, parseActivity } from "./activity";
import { observedStats } from "./metrics";

const start = Date.UTC(2026, 0, 1);
const iso = (sec: number) => new Date(start + sec * 1000).toISOString();
const gp = (sec: number, body = "") =>
  `<trkpt lat="37.123456" lon="127.987654"><time>${iso(sec)}</time>${body}</trkpt>`;
const gpx = (body: string, type = "running", creator = "Synthetic") =>
  `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><name>PRIVATE RUN NAME</name><type>${type}</type>${body}</trk></gpx>`;
const tcx = (body: string) =>
  `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:a="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Activities>${body}</Activities></TrainingCenterDatabase>`;
const lap = (time = 600, distance = 1500, body = "") =>
  `<Lap StartTime="${iso(0)}"><TotalTimeSeconds>${time}</TotalTimeSeconds><DistanceMeters>${distance}</DistanceMeters><AverageHeartRateBpm><Value>145</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>170</Value></MaximumHeartRateBpm>${body}</Lap>`;
const activity = (sport = "Running", body = lap()) =>
  `<Activity Sport="${sport}"><Id>${iso(0)}</Id>${body}</Activity>`;
const tp = (sec: number, distance: number, extra = "") =>
  `<Trackpoint><Time>${iso(sec)}</Time><Position><LatitudeDegrees>37.123456</LatitudeDegrees><LongitudeDegrees>127.987654</LongitudeDegrees></Position><DistanceMeters>${distance}</DistanceMeters><HeartRateBpm><Value>145</Value></HeartRateBpm>${extra}</Trackpoint>`;

function fit(
  options: {
    pause?: boolean;
    summaryOnly?: boolean;
    bike?: boolean;
    second?: boolean;
    localTime?: boolean;
  } = {},
) {
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "development",
    product: 1,
    serialNumber: 123456789,
    timeCreated: new Date(start),
  } as FileIdMesg);
  const one = (base: number, sport: "running" | "cycling") => {
    if (!options.summaryOnly)
      for (let sec = 0; sec <= 600; sec += 5)
        encoder.onMesg(Profile.MesgNum.RECORD, {
          timestamp: new Date(base + sec * 1000),
          heartRate: 145,
          speed: 2.5,
          cadence: 85,
          fractionalCadence: 0.5,
          distance: sec * 2.5,
          positionLat: 123456789,
          positionLong: 234567890,
        } as RecordMesg);
    if (options.pause) {
      encoder.onMesg(Profile.MesgNum.EVENT, {
        timestamp: new Date(base + 200000),
        event: "timer",
        eventType: "stop",
      } as EventMesg);
      encoder.onMesg(Profile.MesgNum.EVENT, {
        timestamp: new Date(base + 220000),
        event: "timer",
        eventType: "start",
      } as EventMesg);
    }
    encoder.onMesg(Profile.MesgNum.SESSION, {
      startTime: new Date(base),
      timestamp: new Date(base + 600000),
      sport,
      totalElapsedTime: 600,
      totalTimerTime: options.pause ? 580 : 600,
      totalDistance: 1500,
      avgHeartRate: 145,
      maxHeartRate: 165,
      avgCadence: 85,
      avgFractionalCadence: 0.5,
    } as SessionMesg);
  };
  one(start, options.bike ? "cycling" : "running");
  if (options.second) one(start + 86400000, "running");
  if (options.localTime)
    encoder.onMesg(Profile.MesgNum.ACTIVITY, {
      timestamp: new Date(start + 600000),
      localTimestamp: (start + 600000 + 32400000 - 631065600000) / 1000,
      numSessions: 1,
      type: "manual",
    } as ActivityMesg);
  return encoder.close();
}

describe("local GPX/TCX/FIT activity normalization", () => {
  it("reads GPX namespace extensions but never retains names, coordinates or device identifiers", () => {
    const points = Array.from({ length: 121 }, (_, i) =>
      gp(
        i * 5,
        `<extensions><t:TrackPointExtension><t:hr>145</t:hr><t:cad>85</t:cad><speed>2.5</speed></t:TrackPointExtension></extensions>`,
      ),
    ).join("");
    const result = parseActivity(gpx(`<trkseg>${points}</trkseg>`), "gpx");
    expect(result.sessions[0]).toMatchObject({
      durationMs: 600000,
      distanceM: null,
      meanHr: null,
      offsetMs: null,
      detailAvailable: true,
    });
    expect(result.sessions[0].issues).toContain("activity-elapsed-time");
    expect(result.details[0].points[0]).toMatchObject({
      hr: 145,
      speed: 2.5,
      cadence: 170,
      distance: null,
    });
    expect(observedStats(result.details[0])).toMatchObject({
      meanHr: 145,
      speedCoverage: 1,
    });
    for (const secret of [
      "PRIVATE RUN NAME",
      "37.123456",
      "127.987654",
      '"lat"',
      '"lon"',
      "Synthetic",
    ])
      expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps GPS-only GPX speeds and distances unavailable, and identifies absent sport", () => {
    const result = parseActivity(
      gpx(`<trkseg>${gp(0)}${gp(600)}</trkseg>`, ""),
      "gpx",
    );
    expect(result.sessions[0]).toMatchObject({
      distanceM: null,
      durationMs: 600000,
    });
    expect(result.sessions[0].issues).toContain("activity-type-unknown");
    expect(
      result.sessions[0].quality?.find(
        (q) => q.code === "activity-speed-unavailable",
      )?.evidence,
    ).toContain("GPS 좌표");
    expect(
      result.details[0].points.every(
        (p) => p.hr === null && p.speed === null && p.pace === null,
      ),
    ).toBe(true);
  });

  it("honors explicit local offsets while treating UTC Z as unknown runner timezone", () => {
    const xml = gpx(`<trkseg>${gp(0)}${gp(600)}</trkseg>`)
      .replaceAll("2026-01-01T00:", "2026-01-01T09:")
      .replaceAll("Z</time>", "+09:00</time>");
    expect(parseActivity(xml, "gpx").sessions[0]).toMatchObject({
      startMs: start,
      offsetMs: 32400000,
      date: "2026-01-01",
    });
    expect(
      parseActivity(gpx(`<trkseg>${gp(0)}${gp(600)}</trkseg>`), "gpx")
        .sessions[0].issues,
    ).toContain("offset-unknown");
  });

  it("does not bridge GPX segments or sparse measurement gaps", () => {
    const body = (sec: number) =>
      gp(sec, "<extensions><hr>145</hr><speed>2.5</speed></extensions>");
    const result = parseActivity(
      gpx(
        `<trkseg>${body(0)}${body(5)}</trkseg><trkseg>${body(10)}${body(15)}${body(600)}</trkseg>`,
      ),
      "gpx",
    );
    expect(result.details[0].points.find((p) => p.time === 7.5)).toMatchObject({
      hr: null,
      speed: null,
    });
    expect(observedStats(result.details[0]).hrSec).toBe(10);
    expect(result.sessions[0].issues).toContain("activity-segment-break");
    expect(
      result.sessions[0].quality?.some((q) => q.code === "observation-gap"),
    ).toBe(true);
  });

  it("recognizes Strava GPX run code only with a Strava origin and skips known cycling", () => {
    const body = `<trkseg>${gp(0)}${gp(600)}</trkseg>`;
    expect(
      parseActivity(gpx(body, "9"), "gpx", "strava").sessions,
    ).toHaveLength(1);
    expect(
      parseActivity(gpx(body, "9", "StravaGPX"), "gpx").sessions,
    ).toHaveLength(1);
    expect(parseActivity(gpx(body, "9"), "gpx").sessions).toHaveLength(0);
    expect(parseActivity(gpx(body, "cycling"), "gpx").sessions).toHaveLength(0);
  });

  it("preserves TCX lap timer duration and distance independently from wall time", () => {
    const points = `<Track>${tp(0, 0, "<Extensions><a:TPX><a:Speed>2.5</a:Speed><a:RunCadence>85</a:RunCadence></a:TPX></Extensions>")}${tp(900, 1500)}</Track>`;
    const result = parseActivity(
      tcx(activity("Running", lap(600, 1500, points))),
      "tcx",
      "strava",
    );
    expect(result.sessions[0]).toMatchObject({
      source: "strava",
      durationMs: 600000,
      distanceM: 1500,
      endMs: start + 900000,
      meanHr: 145,
      maxHr: 170,
    });
    expect(result.details[0].points[0]).toMatchObject({
      speed: 2.5,
      cadence: 170,
    });
    expect(result.sessions[0].issues).not.toContain("activity-elapsed-time");
  });

  it("accepts summary-only TCX runs, skips bikes, and does not fabricate a finish timestamp", () => {
    const result = parseActivity(tcx(activity() + activity("Biking")), "tcx");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      durationMs: 600000,
      distanceM: 1500,
      detailAvailable: false,
      endMs: null,
    });
    expect(result.details).toEqual([]);
    expect(result.warnings[0]).toContain("1개");
  });

  it("uses only observed cumulative-distance intervals for inferred speeds", () => {
    const result = parseActivity(
      tcx(
        activity(
          "Running",
          lap(
            600,
            1500,
            `<Track>${tp(0, 0)}${tp(5, 12.5)}${tp(10, 25)}${tp(600, 1500)}</Track>`,
          ),
        ),
      ),
      "tcx",
    );
    expect(result.details[0].points.slice(0, 2).map((p) => p.speed)).toEqual([
      2.5, 2.5,
    ]);
    expect(result.details[0].points[2].speed).toBe(2.5);
    expect(result.details[0].points[3].speed).toBeNull();
    expect(observedStats(result.details[0]).speedSec).toBe(10);
    expect(result.sessions[0].issues).toContain("activity-distance-speed");
  });

  it("keeps conflicting duplicate measurements unavailable even after a third value", () => {
    const result = parseActivity(
      gpx(
        `<trkseg>${gp(0, "<hr>140</hr>")}${gp(0, "<hr>150</hr>")}${gp(0, "<hr>140</hr>")}${gp(600)}</trkseg>`,
      ),
      "gpx",
    );
    expect(result.details[0].points[0].hr).toBeNull();
    expect(result.sessions[0].issues).toContain("conflicting-points");
  });

  it("decodes actual FIT binary, scales SI units, isolates multiple sessions and strips private fields", () => {
    const result = parseActivity(fit({ second: true }), "fit", "strava");
    expect(result.sessions).toHaveLength(2);
    expect(result.details).toHaveLength(2);
    expect(result.sessions[0]).toMatchObject({
      source: "strava",
      durationMs: 600000,
      distanceM: 1500,
      meanHr: 145,
      meanCadence: 171,
      offsetMs: null,
    });
    expect(result.details[0].points[0]).toMatchObject({
      speed: 2.5,
      cadence: 171,
      hr: 145,
    });
    expect(result.details[1].points[0].epochMs).toBe(start + 86400000);
    expect(JSON.stringify(result)).not.toContain("positionLat");
    expect(JSON.stringify(result)).not.toContain("serialNumber");
  });

  it("preserves FIT pauses and timer duration, supports summary-only runs, and excludes bikes", () => {
    const result = parseActivity(fit({ pause: true }), "fit");
    expect(result.sessions[0].durationMs).toBe(580000);
    expect(result.details[0].points.find((p) => p.time === 210)).toMatchObject({
      hr: null,
      speed: null,
    });
    expect(observedStats(result.details[0]).hrSec).toBeLessThanOrEqual(580);
    expect(
      parseActivity(fit({ summaryOnly: true }), "fit").sessions[0]
        .detailAvailable,
    ).toBe(false);
    expect(parseActivity(fit({ bike: true }), "fit").sessions).toHaveLength(0);
  });

  it("uses an explicit FIT local timestamp only when it belongs to the session finish", () => {
    const result = parseActivity(fit({ localTime: true }), "fit");
    expect(result.sessions[0]).toMatchObject({
      offsetMs: 32400000,
      date: "2026-01-01",
    });
    expect(result.sessions[0].issues).not.toContain("offset-unknown");
    const multiple = parseActivity(
      fit({ localTime: true, second: true }),
      "fit",
    );
    expect(multiple.sessions[1].offsetMs).toBeNull();
  });

  it("rejects corrupt FIT, malformed XML, custom entities, oversized tokens and invalid dates", () => {
    const corrupted = fit();
    corrupted[30] ^= 1;
    expect(() => parseActivity(corrupted, "fit")).toThrow();
    for (const xml of [
      "<Other/>",
      "<gpx><trk></gpx>",
      '<!DOCTYPE gpx SYSTEM "https://example.com"><gpx/>',
      '<!DOCTYPE gpx [<!ENTITY x "SECRET">]><gpx/>',
      '<gpx a="&unknown;"/>',
    ])
      expect(() => parseActivity(xml, "gpx")).toThrow();
    expect(() =>
      parseActivity(
        '<gpx x="' + "a".repeat(ACTIVITY_LIMITS.token + 32768),
        "gpx",
      ),
    ).toThrow(/제한/);
    expect(() =>
      parseActivity("<gpx>" + "<Nested>".repeat(33), "gpx"),
    ).toThrow();
    const invalid = gpx(`<trkseg>${gp(0)}${gp(600)}</trkseg>`).replaceAll(
      "2026-01-01",
      "2026-02-30",
    );
    expect(parseActivity(invalid, "gpx").sessions).toHaveLength(0);
  });
});
