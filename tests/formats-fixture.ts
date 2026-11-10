// Generated activity-format examples, never files from a real fitness account.
import { gzipSync } from "node:zlib";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const start = (day: number) => Date.UTC(2026, 0, day, 0);
const local = (day: number) =>
  `2026-01-${String(day).padStart(2, "0")}T09:00:00+09:00`;
const privateText = "SYNTHETIC-PRIVATE-ACCOUNT";
function tcx(day: number, hr: number) {
  const points = Array.from(
    { length: 181 },
    (_, i) => `<Trackpoint>
    <Time>${new Date(start(day) + i * 10000).toISOString()}</Time>
    <DistanceMeters>${(i * 5000) / 180}</DistanceMeters>
    <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>
    <Cadence>85</Cadence>
    <Extensions><TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Speed>${5000 / 1800}</Speed></TPX></Extensions>
  </Trackpoint>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
    <Activities><Activity Sport="Running"><Id>${local(day)}</Id><Lap StartTime="${local(day)}">
      <TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters>
      <AverageHeartRateBpm><Value>${hr}</Value></AverageHeartRateBpm>
      <MaximumHeartRateBpm><Value>${hr}</Value></MaximumHeartRateBpm>
      <Track>${points}</Track>
    </Lap></Activity></Activities><Author><Name>${privateText}</Name></Author>
  </TrainingCenterDatabase>`;
}

function nike(day: number, timeline: boolean) {
  const from = start(day),
    hr = timeline ? 153 : 148;
  const values = (value: number) =>
    Array.from({ length: 180 }, (_, i) => ({
      start_epoch_ms: from + i * 10000,
      end_epoch_ms: from + (i + 1) * 10000,
      value,
    }));
  return JSON.stringify({
    id: privateText,
    type: "run",
    start_epoch_ms: from,
    end_epoch_ms: from + 1800000,
    active_duration_ms: 1800000,
    time_zone: "Asia/Seoul",
    summaries: [
      { metric: "distance", summary: "sum", value: 5, unit: "KM" },
      { metric: "heart_rate", summary: "mean", value: hr, unit: "BPM" },
      { metric: "heart_rate", summary: "max", value: 160, unit: "BPM" },
    ],
    ...(timeline
      ? {
          metrics: [
            { type: "heart_rate", unit: "BPM", values: values(hr) },
            { type: "speed", unit: "M/S", values: values(5000 / 1800) },
          ],
        }
      : {}),
    profile: { email: "synthetic@example.invalid", name: privateText },
  });
}

async function archive(entries: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, text] of Object.entries(entries))
    await writer.add(name, new TextReader(text));
  return Buffer.from(await (await writer.close()).arrayBuffer());
}

export const stravaFormatsZip = () =>
  archive({
    "activities.csv": [
      "Activity ID,Activity Date,Activity Name,Activity Type,Filename",
      `100,Jan 01 2026,${privateText},Run,activities/synthetic-old.tcx`,
      `101,Jan 03 2026,${privateText},Run,activities/synthetic-new.tcx`,
      `102,Jan 04 2026,${privateText},Ride,activities/synthetic-ride.tcx`,
    ].join("\n"),
    "activities/synthetic-old.tcx": tcx(1, 155),
    "activities/synthetic-new.tcx": tcx(3, 150),
    // The index must exclude this file even though its payload resembles a run.
    "activities/synthetic-ride.tcx": tcx(4, 180),
    "profile.json": "PRIVATE invalid unrelated JSON",
  });

export const nikeFormatsZip = () =>
  archive({
    "activities/synthetic-summary.json": nike(3, false),
    "activities/synthetic-timeline.json": nike(1, true),
    "profile.json": "PRIVATE invalid unrelated JSON",
  });

export function gpxFormatGzip() {
  const points = Array.from(
    { length: 181 },
    (_, i) =>
      `<trkpt lat="37.123456" lon="127.987654"><time>${new Date(start(3) + i * 10000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>151</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`,
  ).join("");
  return gzipSync(
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Synthetic exporter" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><metadata><author><name>${privateText}</name></author></metadata><trk><name>${privateText}</name><type>running</type><trkseg>${points}</trkseg></trk></gpx>`,
  );
}
