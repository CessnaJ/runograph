// Generated synthetic workouts only. No personal export values or source files.
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

export async function upgradeZip() {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  const dates = [
    "2026-02-02",
    "2026-02-06",
    "2026-02-10",
    "2026-02-14",
    "2026-02-18",
    "2026-02-22",
    "2026-02-26",
    "2026-03-02",
    "2026-03-18",
    "2026-03-21",
    "2026-03-24",
    "2026-03-27",
    "2026-03-30",
    "2026-04-02",
    "2026-04-05",
    "2026-04-08",
    "2026-05-08",
    "2026-05-10",
  ];
  const rows: string[] = [];
  for (const [i, date] of dates.entries()) {
    const start = Date.parse(date + "T00:00:00Z");
    const latest = i === dates.length - 1;
    const points = Array.from({ length: 241 }, (_, j) => {
      const speed = latest && j >= 222 ? 3.1 : 2.4;
      return {
        start_time: start + j * 10000,
        heart_rate: i < 8 ? 150 : 145,
        speed,
        cadence: 170,
        distance: j ? speed * 10 : 0,
      };
    });
    const distance = points.reduce((sum, p) => sum + p.distance, 0);
    rows.push(
      `1002,${date} 00:00:00,${date} 00:40:00,UTC+0900,2400000,${distance},145,160,up-${i}.json,up-private-${i},up-device`,
    );
    await writer.add(
      `export/jsons/com.samsung.shealth.exercise/00/up-${i}.json`,
      new TextReader(JSON.stringify(points)),
    );
  }
  await writer.add(
    "export/com.samsung.shealth.exercise.20260510000000.csv",
    new TextReader(
      "com.samsung.shealth.exercise,7006011,18\nexercise_type,start_time,end_time,time_offset,duration,distance,mean_heart_rate,max_heart_rate,live_data,datauuid,deviceuuid\n" +
        rows.join("\n"),
    ),
  );
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
