// Entirely synthetic test data. Never included in the application bundle.
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
export async function testZip(
  runs = 4,
  unsafe = false,
  scenario: "default" | "growth" | "gaps" = "default",
) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  const header = [
    "exercise_type",
    "start_time",
    "end_time",
    "time_offset",
    "duration",
    "distance",
    "mean_heart_rate",
    "max_heart_rate",
    "live_data",
    "datauuid",
    "deviceuuid",
  ];
  const rows: string[] = [];
  for (let i = 0; i < runs; i++) {
    const start =
        scenario === "growth"
          ? Date.UTC(2026, i < runs / 2 ? 0 : 1, 5 + (i % (runs / 2)) * 2, 0)
          : Date.UTC(2026, 0, 1 + i, 0),
      date = new Date(start).toISOString().slice(0, 10),
      end = new Date(start + (scenario === "gaps" ? 92400 : 2400) * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    rows.push(
      `1002,${date} 00:00:00,${end},UTC+0900,2400000,5714.285714,140,160,test-${i}.json,test-uuid-${i},synthetic-device-id`,
    );
    const points = Array.from({ length: 241 }, (_, j) => ({
      start_time: start + j * 10000,
      heart_rate:
        (scenario === "growth" ? (i < runs / 2 ? 150 : 145) : 140) +
        Math.round(Math.sin(j / 8) * 5),
      speed: 1000 / 420,
      cadence: 170 + Math.round(Math.cos(j / 10) * 4),
      distance: j === 0 ? 0 : (1000 / 420) * 10,
    }));
    if (scenario === "gaps") {
      for (let j = 121; j < points.length; j++)
        points[j].start_time += 90000 * 1000;
    }
    await writer.add(
      `export/jsons/com.samsung.shealth.exercise/00/test-${i}.json`,
      new TextReader(JSON.stringify(points)),
    );
  }
  await writer.add(
    "export/com.samsung.shealth.exercise.20260101000000.csv",
    new TextReader(
      `com.samsung.shealth.exercise,7006011,18\n${header.join(",")}\n${rows.join("\n")}`,
    ),
  );
  await writer.add(
    unsafe ? "../escape.txt" : "export/unrelated.txt",
    new TextReader("not exercise data"),
  );
  return Buffer.from(await (await writer.close()).arrayBuffer());
}
