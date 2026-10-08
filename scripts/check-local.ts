// Local-only verification. Never upload this ZIP or copy results into public assets.
import { openAsBlob } from "node:fs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Archive } from "../src/core/archive";
import { aggregate, profile } from "../src/core/metrics";
import type { Profile } from "../src/core/types";
import { qualityIssues } from "../src/core/quality";
import {
  buildStableWindows,
  compare,
  primaryRange,
  STABILITY_DEFAULTS,
  suggestComparison,
} from "../src/core/analysis";
import { paceDomain } from "../src/core/chart";
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
const records: unknown[] = [];
let failures = 0,
  points = 0;
for (const s of sessions) {
  try {
    const d = await archive.detail(s);
    s.quality = qualityIssues(s, d);
    points += d.points.length;
    const main = primaryRange(d);
    records.push({
      date: s.date,
      quality: s.quality,
      main,
      paceDomain: paceDomain(d, ...main),
      fullPaceDomain: paceDomain(d, ...main, true),
      stabilityContexts: [90, 120, 180].map((context) => ({
        context,
        ...buildStableWindows(d, { ...STABILITY_DEFAULTS, context })
          .diagnostics,
      })),
      stabilityCv: [0.05, 0.08, 0.12].map((cv) => ({
        cv,
        ...buildStableWindows(d, { ...STABILITY_DEFAULTS, cv }).diagnostics,
      })),
    });
    const p = profile(d);
    for (const w of p.windows ?? []) {
      assert.ok(w.sec >= 48 && w.sec <= 60 && w.samples >= 4);
      assert.ok(w.from >= 360 && w.to <= d.points.at(-1)!.time);
      assert.ok(
        !s.quality.some(
          (q) =>
            q.code === "observation-gap" &&
            q.from! < w.to &&
            q.to! > w.from - 60,
        ),
      );
    }
    const full = paceDomain(d, ...main, true);
    assert.ok(
      d.points
        .filter(
          (p) => p.time >= main[0] && p.time <= main[1] && p.pace !== null,
        )
        .every((p) => p.pace! >= full[0] && p.pace! <= full[1]),
    );
    profiles.push(p);
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
      rawAggregate: aggregate(sessions, profiles, true),
      records,
      comparisons: (["heart", "pace"] as const).map((question) => {
        const cfg = suggestComparison(sessions, profiles, question);
        const start = performance.now();
        const result = compare(sessions, profiles, cfg);
        return { ...result, elapsedMs: performance.now() - start };
      }),
      stableRuns: profiles.filter((p) => (p.windows?.length ?? 0) >= 3).length,
      halves: profiles.filter((p) => p.halves).length,
      drifts: profiles.filter((p) => p.drift).length,
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
