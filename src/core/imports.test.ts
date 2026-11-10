// These archives are generated schema fixtures, never personal export files.
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { Archive, LIMITS } from "./archive";
import { ACTIVITY_LIMITS } from "./activity";
import { appleDocument, appleWorkout } from "../../tests/apple-fixture";

const progress = () => {};
const start = Date.UTC(2026, 0, 1);
const iso = (ms: number) => new Date(ms).toISOString();
const tcx = (day = 0, hr = 150, sport = "Running") => {
  const from = start + day * 86400000;
  const points = Array.from(
    { length: 31 },
    (_, i) => `<Trackpoint>
    <Time>${iso(from + i * 10000)}</Time><DistanceMeters>${(i * 100) / 3}</DistanceMeters>
    <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>
    <Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>${10 / 3}</Speed></TPX></Extensions>
  </Trackpoint>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
    <Activities><Activity Sport="${sport}"><Id>${iso(from)}</Id><Lap StartTime="${iso(from)}">
      <TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters>
      <AverageHeartRateBpm><Value>${hr}</Value></AverageHeartRateBpm>
      <MaximumHeartRateBpm><Value>${hr}</Value></MaximumHeartRateBpm>
      <Track>${points}</Track>
    </Lap></Activity></Activities><Author><Name>SYNTHETIC-PRIVATE-ACCOUNT</Name></Author>
  </TrainingCenterDatabase>`;
};
const gpx = (day = 0, hr = 151) => {
  const from = start + day * 86400000;
  const points = Array.from(
    { length: 31 },
    (_, i) => `<trkpt lat="37.0" lon="127.0">
    <time>${iso(from + i * 10000)}</time>
    <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr><gpxtpx:speed>${10 / 3}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>
  </trkpt>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Synthetic exporter" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
    <metadata><author><name>SYNTHETIC-PRIVATE-ACCOUNT</name></author></metadata>
    <trk><name>SYNTHETIC-PRIVATE-TITLE</name><type>running</type><trkseg>${points}</trkseg></trk>
  </gpx>`;
};
const nike = (day = 0, hr = 152) => {
  const from = start + day * 86400000;
  const values = (value: number) =>
    Array.from({ length: 30 }, (_, i) => ({
      start_epoch_ms: from + i * 10000,
      end_epoch_ms: from + (i + 1) * 10000,
      value,
    }));
  return JSON.stringify({
    id: "SYNTHETIC-PRIVATE-ACCOUNT",
    type: "run",
    start_epoch_ms: from,
    end_epoch_ms: from + 300000,
    active_duration_ms: 300000,
    time_zone: "Asia/Seoul",
    summaries: [{ metric: "distance", summary: "sum", value: 1, unit: "KM" }],
    metrics: [
      { type: "heart_rate", unit: "BPM", values: values(hr) },
      { type: "speed", unit: "M/S", values: values(10 / 3) },
    ],
    profile: { email: "synthetic@example.invalid" },
  });
};
async function zip(entries: Record<string, string>, encrypted = false) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, body] of Object.entries(entries))
    await writer.add(
      name,
      new TextReader(body),
      encrypted ? { password: "synthetic-password" } : {},
    );
  return writer.close();
}
const named = (body: BlobPart, name: string) => new File([body], name);
async function gzip(text: string, name: string) {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return named(await new Response(stream).blob(), name);
}

describe("activity archives and standalone imports", () => {
  it("reads standalone TCX locally and returns its matching detailed observations", async () => {
    const result = await Archive.open(
      named(tcx(), "synthetic-run.tcx"),
      progress,
    );
    try {
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        durationMs: 300000,
        distanceM: 1000,
        detailAvailable: true,
      });
      const detail = await result.archive.detail(result.sessions[0]);
      expect(detail.id).toBe(result.sessions[0].id);
      expect(detail.points[0]).toMatchObject({ hr: 150, speed: 10 / 3 });
      expect(detail.points.at(-1)?.time).toBe(300);
      expect(JSON.stringify(result.sessions)).not.toContain(
        "SYNTHETIC-PRIVATE",
      );
    } finally {
      await result.archive.close();
    }
  });

  it("reads both GPX and gzip GPX without converting GPS coordinates into distance", async () => {
    expect(typeof DecompressionStream).toBe("function");
    for (const file of [
      named(gpx(), "synthetic-run.gpx"),
      await gzip(gpx(), "synthetic-run.gpx.gz"),
    ]) {
      const result = await Archive.open(file, progress);
      try {
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0]).toMatchObject({
          durationMs: 300000,
          distanceM: null,
          detailAvailable: true,
        });
        const detail = await result.archive.detail(result.sessions[0]);
        expect(detail.points[0]).toMatchObject({
          hr: 151,
          speed: 10 / 3,
          distance: null,
        });
        expect(JSON.stringify(detail)).not.toMatch(
          /latitude|longitude|SYNTHETIC-PRIVATE/,
        );
      } finally {
        await result.archive.close();
      }
    }
  });

  it("reads a standalone Nike activity JSON with its explicit unit timelines", async () => {
    const result = await Archive.open(
      named(nike(), "synthetic-run.json"),
      progress,
    );
    try {
      expect(result.archive.source).toBe("nike");
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        source: "nike",
        durationMs: 300000,
        distanceM: 1000,
        detailAvailable: true,
      });
      const detail = await result.archive.detail(result.sessions[0]);
      expect(detail.id).toBe(result.sessions[0].id);
      expect(detail.points[0]).toMatchObject({ hr: 152, speed: 10 / 3 });
      expect(JSON.stringify(result.sessions)).not.toMatch(
        /SYNTHETIC-PRIVATE|example.invalid/,
      );
    } finally {
      await result.archive.close();
    }
  });

  it("uses the Strava bulk activity index to include runs and exclude rides", async () => {
    const csv = [
      "Activity ID,Activity Date,Activity Name,Activity Type,Filename",
      '100,Jan 01 2026,"Synthetic, run",Run,activities/run.tcx',
      "101,Jan 02 2026,Synthetic ride,Ride,activities/ride.tcx",
    ].join("\n");
    const file = await zip({
      "activities.csv": csv,
      "activities/run.tcx": tcx(0, 150),
      // Running in the payload intentionally proves the CSV filter is used.
      "activities/ride.tcx": tcx(1, 180),
      "profile.json": '{"private":',
    });
    const result = await Archive.open(file, progress);
    try {
      expect(result.archive.source).toBe("strava");
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        source: "strava",
        startMs: start,
      });
      expect(
        (await result.archive.detail(result.sessions[0])).points[0].hr,
      ).toBe(150);
    } finally {
      await result.archive.close();
    }
  });

  it("assigns unique anonymous IDs across files and keeps detail IDs matched after date sorting", async () => {
    const file = await zip({
      "activities/older.tcx": tcx(0, 140),
      "activities/newer.tcx": tcx(2, 160),
      "activities/middle.json": nike(1, 150),
      "profile.json":
        "unrelated private profile JSON is intentionally not valid JSON",
    });
    const result = await Archive.open(file, progress);
    try {
      expect(result.sessions).toHaveLength(3);
      expect(new Set(result.sessions.map((s) => s.id)).size).toBe(3);
      expect(result.sessions.map((s) => s.startMs)).toEqual([
        start + 2 * 86400000,
        start + 86400000,
        start,
      ]);
      for (const session of result.sessions) {
        const detail = await result.archive.detail(session);
        expect(detail.id).toBe(session.id);
        expect(detail.points[0].hr).toBe(
          session.startMs === start
            ? 140
            : session.startMs === start + 86400000
              ? 150
              : 160,
        );
        expect(session.id).not.toMatch(/\.tcx|\.json|SYNTHETIC/);
      }
    } finally {
      await result.archive.close();
    }
    const second = await Archive.open(file, progress);
    try {
      expect(second.sessions.map((s) => [s.id, s.startMs])).toEqual(
        result.sessions.map((s) => [s.id, s.startMs]),
      );
    } finally {
      await second.archive.close();
    }
  });

  it("reads recognized activity JSON paths while unrelated profile JSON stays ignored", async () => {
    const file = await zip({
      "activities/run.json": nike(),
      "profile.json": "not JSON, not an activity source",
      "account/preferences.json": '{"private":',
    });
    const result = await Archive.open(file, progress);
    try {
      expect(result.sessions).toHaveLength(1);
      expect(
        (await result.archive.detail(result.sessions[0])).points[0].hr,
      ).toBe(152);
      expect(result.warnings.join()).not.toMatch(/profile|preferences/);
    } finally {
      await result.archive.close();
    }
    await expect(
      Archive.open(await zip({ "profile.json": nike() }), progress),
    ).rejects.toThrow();
  });

  it("keeps Apple Health archives summary-only and ignores their workout route GPX", async () => {
    const file = await zip({
      "apple_health_export/export.xml": appleDocument(
        appleWorkout('totalDistance="5" totalDistanceUnit="km"'),
      ),
      "apple_health_export/workout-routes/route.gpx": gpx(1),
      "apple_health_export/export_cda.xml": "not an activity source",
    });
    const result = await Archive.open(file, progress);
    try {
      expect(result.archive.source).toBe("apple");
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        source: "apple",
        detailAvailable: false,
      });
      await expect(result.archive.detail(result.sessions[0])).rejects.toThrow(
        /요약만 지원/,
      );
    } finally {
      await result.archive.close();
    }
  });

  it("rejects encrypted activity entries and unsafe ZIP paths before parsing", async () => {
    await expect(
      Archive.open(await zip({ "activities/run.tcx": tcx() }, true), progress),
    ).rejects.toThrow(/암호/);
    // Patch equal-length entry names in the generated archive, avoiding a
    // writer that may normalize an unsafe input name on our behalf.
    const valid = await zip({ "xx/run.tcx": tcx() });
    const bytes = new Uint8Array(await valid.arrayBuffer());
    const from = new TextEncoder().encode("xx/run.tcx"),
      to = new TextEncoder().encode("../run.tcx");
    let replacements = 0;
    for (let i = 0; i <= bytes.length - from.length; i++) {
      if (from.every((b, n) => bytes[i + n] === b)) {
        bytes.set(to, i);
        replacements++;
      }
    }
    expect(replacements).toBe(2);
    const unsafe = new Blob([bytes]);
    // zip.js itself can reject traversal before our own path validation runs.
    await expect(Archive.open(unsafe, progress)).rejects.toThrow(
      /경로|Unsafe filename/,
    );
  });

  it("enforces declared file limits and observes cancellation before importing new formats", async () => {
    const big = named(tcx(), "too-large.tcx");
    Object.defineProperty(big, "size", { value: ACTIVITY_LIMITS.bytes + 1 });
    await expect(Archive.open(big, progress)).rejects.toThrow(/제한/);
    const oversizedZip = await zip({ "activities/run.tcx": tcx() });
    Object.defineProperty(oversizedZip, "size", { value: LIMITS.zip + 1 });
    await expect(Archive.open(oversizedZip, progress)).rejects.toThrow(/제한/);
    const controller = new AbortController();
    controller.abort();
    for (const file of [
      named(tcx(), "run.tcx"),
      await gzip(gpx(), "run.gpx.gz"),
      named(nike(), "run.json"),
    ])
      await expect(
        Archive.open(file, progress, controller.signal),
      ).rejects.toThrow();
  });
});
