import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { testZip } from "./fixture";
test("mobile local import, synchronized chart modes/axis/zoom, filters, growth, report and reset", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const external: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5197") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  const response = await page.goto("/");
  expect(response!.headers()["content-security-policy"]).toContain(
    "connect-src 'none'",
  );
  await page
    .getByLabel("삼성헬스 ZIP 불러오기", { exact: true })
    .setInputFiles({
      name: "synthetic-test.zip",
      mimeType: "application/zip",
      buffer: await testZip(),
    });
  await expect(
    page.getByRole("navigation", { name: "주요 화면" }),
  ).toBeVisible();
  await expect(page.getByText("전체 기록 · 4회")).toBeVisible();
  await page.getByRole("button", { name: "러닝", exact: true }).click();
  await page.locator(".run-row").first().click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
  await expect(page.getByTestId("readout")).toContainText("그래프를 눌러");
  await page.getByLabel("측정 시점", { exact: true }).fill("100");
  const readout = await page.getByTestId("readout").innerText();
  await expect(page.getByTestId("shared-cursor")).toHaveCount(2);
  const cursorPositions = await page
    .getByTestId("shared-cursor")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
  expect(new Set(cursorPositions.map((x) => Math.round(x))).size).toBe(1);
  await page.getByRole("button", { name: "구간 선택", exact: true }).click();
  await page.getByLabel("구간 시작", { exact: true }).fill("30");
  await page.getByRole("button", { name: "겹쳐 보기", exact: true }).click();
  await expect(page.getByTestId("timeline")).toHaveCount(1);
  await expect
    .poll(() => page.getByTestId("readout").innerText())
    .toBe(readout);
  const axisBounds = () =>
    page.locator('.plot text[orientation="left"]').evaluateAll((els) =>
      els.map((e) => {
        const box = e.getBoundingClientRect(),
          plot = e.closest(".plot")!.getBoundingClientRect();
        return { left: box.left - plot.left, right: box.right - plot.left };
      }),
    );
  const ticksBefore = await axisBounds();
  expect(ticksBefore.length).toBeGreaterThan(0);
  expect(ticksBefore.every((b) => b.left >= 0 && b.right <= 44)).toBe(true);
  const paths = await page
    .locator(".recharts-line-curve")
    .evaluateAll((els) => els.map((e) => e.getAttribute("d")));
  await page.getByLabel("왼쪽 눈금", { exact: true }).selectOption("pace");
  await expect
    .poll(() =>
      page
        .locator(".recharts-line-curve")
        .evaluateAll((els) => els.map((e) => e.getAttribute("d"))),
    )
    .toEqual(paths);
  const ticksAfter = await axisBounds();
  expect(ticksAfter.length).toBeGreaterThan(0);
  expect(ticksAfter.every((b) => b.left >= 0 && b.right <= 44)).toBe(true);
  await page.getByRole("button", { name: "나눠 보기", exact: true }).click();
  await expect(page.getByLabel("구간 시작", { exact: true })).toHaveValue("30");
  await expect
    .poll(() => page.getByTestId("readout").innerText())
    .toBe(readout);
  await page.getByRole("button", { name: "전체 구간", exact: true }).click();
  await expect(page.getByLabel("구간 시작", { exact: true })).toHaveValue("0");
  await expect(page.getByTestId("shared-cursor")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "성장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "성장과 변화", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("comparison-answer")).toHaveAttribute(
    "data-state",
    "insufficient",
  );
  await expect(page.locator(".period-values")).toContainText("4회");
  await page
    .getByRole("button", { name: "분석 결과 저장", exact: true })
    .click();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSON 파일로 저장", exact: true })
    .click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe("runograph-report.json");
  const report = await readFile((await download.path())!, "utf8");
  expect(report).not.toContain("test-uuid");
  expect(report).not.toContain("test-0.json");
  const parsed = JSON.parse(report);
  expect(parsed.sessions).toHaveLength(4);
  expect(parsed.calculationVersion).toBe("0.2.0");
  expect(parsed.inputRevision).toBeGreaterThan(0);
  expect(parsed.comparisons).toHaveLength(2);
  expect(parsed.comparisons[0]).toMatchObject({
    question: "heart",
    width: 0.08,
  });
  expect(parsed.comparisons[0].elapsedRangeSec).toEqual([300, 1200]);
  expect(report).not.toContain("synthetic-device");
  await page.getByText("전체 기록 · 4회").click();
  await page.getByLabel("시작 날짜", { exact: true }).fill("2026-01-04");
  await expect(page.locator(".global-filters")).toContainText("1회");
  await page.getByRole("button", { name: "어두운 모드", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "불러온 기록 지우기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "삼성헬스 ZIP 불러오기", exact: true }),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(external).toEqual([]);
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(async () => ({
      workers: (await navigator.serviceWorker.getRegistrations()).length,
      caches: await caches.keys(),
      preferences: Object.keys(localStorage).filter(
        (key) => !["runograph-theme", "runograph-layout"].includes(key),
      ),
    })),
  ).toEqual({ workers: 0, caches: [], preferences: [] });
});
test("malformed ZIP recovery and cancellation allow reselection", async ({
  page,
}) => {
  await page.goto("/");
  const file = page.getByLabel("삼성헬스 ZIP 불러오기", { exact: true });
  await file.setInputFiles({
    name: "bad.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not zip"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await file.setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: await testZip(30),
  });
  await page.getByRole("button", { name: "분석 취소", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "주요 화면" })).toHaveCount(
    0,
  );
  await file.setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: await testZip(1),
  });
  await expect(
    page.getByRole("navigation", { name: "주요 화면" }),
  ).toBeVisible();
});

test("320px view, pointer pinning and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await page
    .getByLabel("삼성헬스 ZIP 불러오기", { exact: true })
    .setInputFiles({
      name: "synthetic.zip",
      mimeType: "application/zip",
      buffer: await testZip(1),
    });
  await expect(
    page.getByRole("navigation", { name: "주요 화면" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "러닝", exact: true }).click();
  await page.locator(".run-row").click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page
    .getByTestId("timeline")
    .first()
    .tap({ position: { x: 150, y: 90 } });
  await expect(page.getByTestId("readout")).toContainText("고정");
  await page.getByRole("button", { name: "겹쳐 보기", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await expect(page.getByTestId("readout")).toContainText("고정");
  await page
    .getByRole("button", { name: "다른 ZIP 선택", exact: true })
    .click();
  await page
    .getByLabel("삼성헬스 ZIP 불러오기", { exact: true })
    .setInputFiles({
      name: "synthetic-gaps.zip",
      mimeType: "application/zip",
      buffer: await testZip(1, false, "gaps"),
    });
  await page.getByRole("button", { name: "러닝", exact: true }).click();
  await page.locator(".run-row").click();
  await expect(
    page.getByLabel("그래프에 볼 구간", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".segment-stats")).toContainText("심박 측정 부족");
  await page
    .getByLabel("그래프에 볼 구간", { exact: true })
    .selectOption("[0,1200]");
  await expect(page.locator(".segment-stats")).toContainText(
    "측정된 평균 심박",
  );
  await page.getByRole("button", { name: "구간 선택", exact: true }).click();
  await expect(page.getByLabel("구간 끝", { exact: true })).toHaveValue("1200");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("v0.2 comparison evidence, question changes, exclusions and return preserve conditions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("삼성헬스 ZIP 불러오기", { exact: true })
    .setInputFiles({
      name: "synthetic-growth.zip",
      mimeType: "application/zip",
      buffer: await testZip(16, false, "growth"),
    });
  await expect(
    page.getByRole("navigation", { name: "주요 화면" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "성장", exact: true }).click();
  await expect(page.getByTestId("comparison-answer")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(page.getByTestId("comparison-answer")).toContainText("5.0");
  await expect(page.getByTestId("comparison-answer")).toContainText("bpm 낮음");
  await page.getByLabel("비교 기간", { exact: true }).selectOption("custom");
  await expect(page.getByLabel("기간 길이", { exact: true })).toBeVisible();
  await page.getByLabel("비교 기간", { exact: true }).selectOption("28");
  await page.getByText("비교 조건 조정", { exact: true }).click();
  await page
    .locator('[data-testid="comparison-plot"] .recharts-scatter-symbol')
    .first()
    .click();
  await expect(page.getByLabel("구간 시작", { exact: true })).toHaveValue(
    "360",
  );
  await page
    .getByRole("button", { name: "비교로 돌아가기", exact: true })
    .click();
  const paceBefore = await page
    .getByLabel("비교 페이스", { exact: true })
    .inputValue();
  await page.locator(".evidence-record summary").first().click();
  await page.locator(".evidence-windows button").first().click();
  await expect(page.getByLabel("구간 시작", { exact: true })).toHaveValue(
    "360",
  );
  await expect(
    page.getByRole("button", { name: "비교로 돌아가기", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "비교로 돌아가기", exact: true })
    .click();
  await expect(page.getByLabel("비교 페이스", { exact: true })).toHaveValue(
    paceBefore,
  );
  await page.locator(".evidence-record summary").first().click();
  await page
    .getByRole("button", { name: "이 러닝 빼고 비교", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("comparison-answer")).toContainText("이전 7회");
  await page.getByText("비교에서 뺀 기록 1회·이유", { exact: true }).click();
  await page
    .getByRole("button", { name: "다시 비교에 포함", exact: true })
    .click();
  await expect(page.getByTestId("comparison-answer")).toContainText("이전 8회");
  await page.getByLabel("성장 질문", { exact: true }).selectOption("pace");
  await expect(page.getByLabel("비교 심박", { exact: true })).toBeVisible();
  await expect(page.locator(".period-values")).toContainText("/km");
  await page.getByLabel("성장 질문", { exact: true }).selectOption("duration");
  await expect(
    page.getByRole("heading", {
      name: "운동시간과 연속 달리기",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".growth-table")).toContainText(
    "연속 달리기(추정)",
  );
  await page.getByLabel("성장 질문", { exact: true }).selectOption("halves");
  await expect(page.getByText(/16회에서 전후반을 비교/)).toBeVisible();
  await page.getByLabel("성장 질문", { exact: true }).selectOption("habit");
  await expect(
    page.getByRole("heading", { name: "달린 날과 운동량", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});
