// Local-only verification. Never upload this ZIP or copy results into public assets.
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { Archive } from "../src/core/archive";
import { aggregate, profile } from "../src/core/metrics";
import type { Profile } from "../src/core/types";
const path = process.env.RUNOGRAPH_ZIP;
if (!path) {
  console.error("RUNOGRAPH_ZIP 환경변수로 로컬 ZIP 경로를 지정하세요.");
  process.exit(1);
}
const start = performance.now();
const { archive, sessions, warnings } = await Archive.open(
  await openAsBlob(path),
  () => {},
);
const profiles: Profile[] = [];
const semantics: Record<string, number> = {};
let failures = 0,
  points = 0;
for (const s of sessions) {
  try {
    const d = await archive.detail(s);
    points += d.points.length;
    profiles.push(profile(d));
    semantics[d.distanceSemantics] = (semantics[d.distanceSemantics] ?? 0) + 1;
    s.status = "ready";
  } catch {
    failures++;
  }
}
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/implementation-check.json",
  JSON.stringify(
    {
      sessions: sessions.length,
      points,
      failures,
      semantics,
      warnings,
      aggregate: aggregate(sessions, profiles),
      elapsedMs: performance.now() - start,
    },
    null,
    2,
  ),
);
await archive.close();
if (failures) {
  console.error("일부 상세 파싱 실패. .local/implementation-check.json 확인");
  process.exit(1);
}
console.log(
  "실제 ZIP 파서 및 집계 검증 통과. 개인 수치는 .local/implementation-check.json에만 저장했습니다.",
);
