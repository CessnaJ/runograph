import {
  BlobReader,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import { parseDetail, parseExerciseCsv } from "./parser";
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
    if (file.size > LIMITS.zip)
      throw new Error(
        "ZIP이 512 MB 제한을 넘습니다. 더 작은 내보내기 파일을 선택해 주세요.",
      );
    const archive = new Archive(file);
    const csv: FileEntry[] = [];
    const names = new Set<string>();
    let count = 0;
    try {
      for await (const entry of archive.reader.getEntriesGenerator()) {
        if (signal?.aborted) throw new Error("분석을 취소했습니다.");
        count++;
        if (count > LIMITS.entries)
          throw new Error("ZIP 파일 수가 100,000개 제한을 넘습니다.");
        if (!safePath(entry.filename) || names.has(entry.filename))
          throw new Error("ZIP에 안전하지 않거나 중복된 경로가 있습니다.");
        names.add(entry.filename);
        if (count % 500 === 0)
          progress(`파일 목록 확인 · ${count.toLocaleString()}개`, 0);
        if (entry.directory) continue;
        if (mainCsv(entry.filename)) csv.push(entry);
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
      if (csv.length !== 1)
        throw new Error(
          csv.length
            ? "운동 CSV가 여러 개입니다. 하나의 삼성헬스 내보내기 ZIP을 선택해 주세요."
            : "삼성헬스 운동 CSV를 찾지 못했습니다. 내보낸 원본 ZIP을 선택해 주세요.",
        );
      progress("러닝 요약 읽는 중", 10);
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
  private async read(
    entry: Entry,
    limit: number,
    signal?: AbortSignal,
  ): Promise<string> {
    if (entry.directory || entry.encrypted)
      throw new Error("암호화된 파일 또는 폴더는 읽을 수 없습니다.");
    if (entry.uncompressedSize > limit)
      throw new Error("대상 파일의 압축 해제 크기가 제한을 넘습니다.");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      await entry.getData(
        new WritableStream<Uint8Array>({
          write: (chunk) => {
            bytes += chunk.byteLength;
            this.used += chunk.byteLength;
            if (bytes > limit || this.used > LIMITS.total)
              throw new Error("안전한 압축 해제 크기 제한을 넘었습니다.");
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
        "파일을 읽지 못했습니다. 손상·암호화·미지원 ZIP인지 확인해 주세요.",
      );
    }
  }
  async detail(
    summary: InternalSummary,
    signal?: AbortSignal,
  ): Promise<Detail> {
    const cached = this.cache.get(summary.id);
    if (cached) {
      this.cache.delete(summary.id);
      this.cache.set(summary.id, cached);
      return cached;
    }
    const entries = summary.reference ? this.json.get(summary.reference) : null;
    if (entries?.length !== 1)
      throw new Error("연결된 상세 JSON이 없거나 참조가 모호합니다.");
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
