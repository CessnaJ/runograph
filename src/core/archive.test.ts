import { expect, it } from "vitest";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { Archive, LIMITS, mainCsv, safePath } from "./archive";
async function zip(entries: Record<string, string>) {
  const w = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, text] of Object.entries(entries))
    await w.add(name, new TextReader(text));
  return w.close();
}
const csv =
  "com.samsung.shealth.exercise,1,18\nexercise_type,start_time,end_time,distance,live_data\n1002,2026-01-01 00:00:00,2026-01-01 00:01:00,10,one.json";
it("selects only exercise CSV and links a unique JSON basename, even when unrelated JSON is invalid", async () => {
  const file = await zip({
    "export/com.samsung.shealth.exercise.20260101.csv": csv,
    "export/jsons/com.samsung.shealth.exercise/00/one.json":
      '[{"start_time":1767225600000,"speed":2}]',
    "export/jsons/com.samsung.shealth.exercise/01/unrelated.json": "bad",
    "export/com.samsung.shealth.exercise.weather.1.csv": "bad",
  });
  const { archive, sessions } = await Archive.open(file, () => {});
  expect(sessions).toHaveLength(1);
  expect((await archive.detail(sessions[0])).points[0].speed).toBe(2);
  await archive.close();
});
it("rejects traversal, absolute paths and extension CSVs", () => {
  expect(safePath("../x.json")).toBe(false);
  expect(safePath("/x")).toBe(false);
  expect(safePath("x\\..\\y")).toBe(false);
  expect(mainCsv("com.samsung.shealth.exercise.extension.1.csv")).toBe(false);
});
it("does not choose an ambiguous basename", async () => {
  const file = await zip({
    "com.samsung.shealth.exercise.1.csv": csv,
    "jsons/com.samsung.shealth.exercise/a/one.json": "[]",
    "jsons/com.samsung.shealth.exercise/b/one.json": "[]",
  });
  const { archive, sessions } = await Archive.open(file, () => {});
  expect(sessions[0].status).toBe("invalid");
  await expect(archive.detail(sessions[0])).rejects.toThrow();
  await archive.close();
});
it("enforces declared output size before extracting", async () => {
  const file = await zip({
    "com.samsung.shealth.exercise.1.csv": "a".repeat(LIMITS.csv + 1),
  });
  await expect(Archive.open(file, () => {})).rejects.toThrow(/제한/);
});
it("respects an already-aborted operation and malformed archives", async () => {
  const controller = new AbortController();
  controller.abort();
  const file = await zip({ "com.samsung.shealth.exercise.1.csv": csv });
  await expect(
    Archive.open(file, () => {}, controller.signal),
  ).rejects.toThrow();
  await expect(
    Archive.open(new Blob(["invalid zip"]), () => {}),
  ).rejects.toThrow();
});
