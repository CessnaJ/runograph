import {
  BlobReader,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import { parseDetail, parseExerciseCsv } from "./parser";
import { AppleHealthParser, APPLE_LIMITS } from "./apple";
import { APPLE_DETAIL_NOTICE } from "./copy";
import type { Detail, InternalSummary } from "./types";
export const LIMITS = {
  zip: 512 * 1024 ** 2,
  entries: 100000,
  csv: 16 * 1024 ** 2,
  json: 8 * 1024 ** 2,
  total: 128 * 1024 ** 2,
  profileSamples: 500000,
};
export function safePath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[a-z]:/i.test(path) &&
    !path.split("/").some((s) => s === ".." || s === ".") &&
    !path.includes("\0")
  );
}
export function mainCsv(path: string): boolean {
  return /^(?:com\.samsung\.(?:shealth|health)\.exercise)(?:\.\d+)?\.csv$/i.test(
    path.split("/").at(-1) ?? "",
  );
}
export class Archive {
  source: "samsung" | "apple" = "samsung";
  private reader: ZipReader<Blob>;
  private json = new Map<string, FileEntry[]>();
  private cache = new Map<string, Detail>();
  private used = 0;
  private constructor(file: Blob) {
    this.reader = new ZipReader(new BlobReader(file), {
      useWebWorkers: false,
      checkSignature: true,
    });
  }
  static async open(
    file: Blob,
    progress: (phase: string, percent: number) => void,
    signal?: AbortSignal,
  ) {
    const head = await file.slice(0, 128).text();
    const isXml = /^\s*(?:<\?xml\b|<HealthData\b|<!DOCTYPE\b)/.test(head);
    if (isXml) {
      const archive = new Archive(file);
      archive.source = "apple";
      const result = await archive.readApple(
        file.size,
        (sink) => file.stream().pipeTo(sink, { signal }),
        progress,
        signal,
      );
      return { archive, ...result };
    }
    if (file.size > LIMITS.zip)
      throw new Error(
        "512 MB까지 읽을 수 있어요. 이 ZIP은 크기 제한을 넘었어요. 더 작은 내보내기 파일을 선택해 주세요.",
      );
    const archive = new Archive(file);
    const csv: FileEntry[] = [];
    const xml: FileEntry[] = [];
    const names = new Set<string>();
    let count = 0;
    try {
      for await (const entry of archive.reader.getEntriesGenerator()) {
        if (signal?.aborted) throw new Error("분석을 취소했어요.");
        count++;
        if (count > LIMITS.entries)
          throw new Error(
            "ZIP 안의 파일이 10만 개 제한을 넘었어요. 더 작은 내보내기 파일을 선택해 주세요.",
          );
        if (!safePath(entry.filename) || names.has(entry.filename))
          throw new Error(
            "ZIP 안에 읽을 수 없는 파일 경로나 중복된 파일이 있어요. 원본 내보내기 ZIP을 선택해 주세요.",
          );
        names.add(entry.filename);
        if (count % 500 === 0)
          progress(`ZIP 안의 파일 확인 · ${count.toLocaleString()}개`, 0);
        if (entry.directory) continue;
        if (entry.filename.split("/").at(-1) === "export.xml") xml.push(entry);
        else if (mainCsv(entry.filename)) csv.push(entry);
        else if (
          /(?:^|\/)jsons\/com\.samsung\.(?:shealth|health)\.exercise\//.test(
            entry.filename,
          ) &&
          entry.filename.endsWith(".json")
        ) {
          const name = entry.filename.split("/").at(-1)!;
          archive.json.set(name, [...(archive.json.get(name) ?? []), entry]);
        }
      }
      if (xml.length) {
        if (xml.length !== 1 || csv.length)
          throw new Error(
            "여러 내보내기 파일이 섞여 있어요. 원본 파일 하나를 선택해 주세요.",
          );
        const entry = xml[0];
        if (entry.encrypted)
          throw new Error("암호로 잠긴 파일은 읽을 수 없어요.");
        archive.source = "apple";
        const result = await archive.readApple(
          entry.uncompressedSize,
          (sink) =>
            entry.getData(sink, {
              signal,
              checkSignature: true,
              useWebWorkers: false,
            }),
          progress,
          signal,
        );
        return { archive, ...result };
      }
      if (csv.length !== 1)
        throw new Error(
          csv.length
            ? "여러 내보내기 파일이 섞여 있어요. 삼성헬스에서 다운로드한 ZIP 하나를 선택해 주세요."
            : "지원하는 운동 기록을 찾지 못했어요. 삼성헬스 ZIP 또는 애플 건강 export.xml이 들어 있는 ZIP을 선택해 주세요.",
        );
      progress("러닝 기록을 읽고 있어요", 10);
      const result = parseExerciseCsv(
        await archive.read(csv[0], LIMITS.csv, signal),
      );
      for (const s of result.sessions) {
        if (!s.reference) {
          s.status = "missing";
          continue;
        }
        if (!/^[^/\\:]+\.json$/i.test(s.reference)) {
          s.status = "invalid";
          s.issues.push("invalid-reference");
          continue;
        }
        const matches = archive.json.get(s.reference);
        if (!matches?.length) s.status = "missing";
        else if (matches.length !== 1) {
          s.status = "invalid";
          s.issues.push("ambiguous-reference");
        }
      }
      return { archive, ...result };
    } catch (error) {
      await archive.close();
      throw error;
    }
  }
  private async readApple(
    size: number,
    consume: (sink: WritableStream<Uint8Array>) => Promise<unknown>,
    progress: (phase: string, percent: number) => void,
    signal?: AbortSignal,
  ) {
    if (size > APPLE_LIMITS.xml)
      throw new Error(
        "애플 건강 XML은 압축을 푼 크기 1 GB까지 읽을 수 있어요. 크기 제한을 넘었어요.",
      );
    const parser = new AppleHealthParser();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0,
      lastPercent = -1;
    await consume(
      new WritableStream<Uint8Array>({
        write(chunk) {
          if (signal?.aborted) throw new Error("분석을 취소했어요.");
          bytes += chunk.byteLength;
          if (bytes > APPLE_LIMITS.xml)
            throw new Error("애플 건강 XML의 크기 제한을 넘었어요.");
          parser.write(decoder.decode(chunk, { stream: true }));
          const percent = Math.min(
            90,
            Math.floor((bytes / Math.max(size, 1)) * 90),
          );
          if (percent !== lastPercent) {
            progress("애플 건강에서 러닝 요약을 읽고 있어요", percent);
            lastPercent = percent;
          }
        },
      }),
    );
    parser.write(decoder.decode());
    return parser.finish();
  }
  private async read(
    entry: Entry,
    limit: number,
    signal?: AbortSignal,
  ): Promise<string> {
    if (entry.directory || entry.encrypted)
      throw new Error(
        "암호로 잠긴 파일은 읽을 수 없어요. 삼성헬스에서 다운로드한 원본 ZIP을 선택해 주세요.",
      );
    if (entry.uncompressedSize > limit)
      throw new Error("ZIP 안의 파일이 읽기 크기 제한을 넘었어요.");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      await entry.getData(
        new WritableStream<Uint8Array>({
          write: (chunk) => {
            bytes += chunk.byteLength;
            this.used += chunk.byteLength;
            if (bytes > limit || this.used > LIMITS.total)
              throw new Error(
                "ZIP을 풀면서 읽을 수 있는 크기 제한을 넘었어요. 더 작은 내보내기 파일을 선택해 주세요.",
              );
            chunks.push(chunk);
          },
        }),
        { signal, checkSignature: true, useWebWorkers: false },
      );
      const array = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        array.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(array);
    } catch (error) {
      if (error instanceof Error && /제한/.test(error.message)) throw error;
      throw new Error(
        "ZIP 파일을 읽지 못했어요. 손상되거나 암호로 잠겼을 수 있어요. 삼성헬스에서 다시 다운로드한 파일을 선택해 주세요.",
      );
    }
  }
  async detail(
    summary: InternalSummary,
    signal?: AbortSignal,
  ): Promise<Detail> {
    if (this.source === "apple") throw new Error(APPLE_DETAIL_NOTICE);
    const cached = this.cache.get(summary.id);
    if (cached) {
      this.cache.delete(summary.id);
      this.cache.set(summary.id, cached);
      return cached;
    }
    const entries = summary.reference ? this.json.get(summary.reference) : null;
    if (entries?.length !== 1)
      throw new Error(
        "이 러닝의 시간별 측정 파일을 찾지 못했어요. 파일이 없거나 같은 이름의 파일이 여러 개 있어요.",
      );
    const detail = parseDetail(
      await this.read(entries[0], LIMITS.json, signal),
      summary,
    );
    // Up to three timelines; conservative object-size estimate, not a mobile RAM guarantee.
    if (detail.points.length * 160 <= 32 * 1024 ** 2) {
      this.cache.set(summary.id, detail);
      while (
        this.cache.size > 3 ||
        [...this.cache.values()].reduce(
          (s, d) => s + d.points.length * 160,
          0,
        ) >
          32 * 1024 ** 2
      )
        this.cache.delete(this.cache.keys().next().value!);
    }
    return detail;
  }
  newReadBudget() {
    this.used = 0;
  }
  async close() {
    this.cache.clear();
    this.json.clear();
    await this.reader.close();
  }
}
