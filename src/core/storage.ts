import type { Dataset, Detail } from "./types";
import { ANALYSIS_VERSION } from "./analysis";

export interface SavedRuns {
  formatVersion: 1;
  analysisVersion: string;
  generation: string;
  savedAt: string;
  data: Dataset;
}
const DB = "runograph-records";
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("meta");
      request.result.createObjectStore("details");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("다른 runograph 탭을 닫고 다시 시도해 주세요."));
  });
}
async function read<T>(
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function write(stores: string[], fn: (tx: IDBTransaction) => void) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("기기 보관을 마치지 못했어요."));
      tx.onerror = () => reject(tx.error);
      fn(tx);
    });
  } finally {
    db.close();
  }
}
export async function loadSavedRuns() {
  const saved = await read<SavedRuns>("meta", "active");
  if (
    saved &&
    (saved.formatVersion !== 1 || saved.analysisVersion !== ANALYSIS_VERSION)
  )
    throw new Error(
      "보관한 기록의 계산 버전이 달라요. 원본 ZIP을 다시 불러와 보관해 주세요.",
    );
  return saved;
}
export const loadSavedDetail = (generation: string, id: string) =>
  read<Detail>("details", [generation, id]);
export const saveDetail = (generation: string, detail: Detail) =>
  write(["details"], (tx) => {
    tx.objectStore("details").put(detail, [generation, detail.id]);
  });
export const discardGeneration = (generation: string) =>
  write(["meta", "details"], (tx) => {
    tx.objectStore("details").delete(
      IDBKeyRange.bound([generation], [generation, []]),
    );
    const meta = tx.objectStore("meta"),
      request = meta.get("active");
    request.onsuccess = () => {
      if (request.result?.generation === generation) meta.delete("active");
    };
  });
export const commitSavedRuns = (snapshot: SavedRuns) =>
  write(["meta"], (tx) => {
    tx.objectStore("meta").put(snapshot, "active");
  });
export const clearSavedRuns = () =>
  write(["meta", "details"], (tx) => {
    tx.objectStore("meta").clear();
    tx.objectStore("details").clear();
  });
export const updateSavedData = (generation: string, data: Dataset) =>
  write(["meta"], (tx) => {
    const store = tx.objectStore("meta"),
      request = store.get("active");
    request.onsuccess = () => {
      const saved = request.result as SavedRuns | undefined;
      if (saved?.generation === generation)
        store.put({ ...saved, data }, "active");
    };
  });
