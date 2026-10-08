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
  await page.getByLabel("삼성헬스 ZIP 선택", { exact: true }).setInputFiles({
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
  await expect(page.getByTestId("timeline")).toHaveCount(3);
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
  await expect(page.getByTestId("readout")).toContainText("시점을 선택하면");
  await page.getByLabel("관측 시점", { exact: true }).fill("100");
  const readout = await page.getByTestId("readout").innerText();
  await expect(page.getByTestId("shared-cursor")).toHaveCount(3);
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
  await page.getByLabel("Y축 눈금", { exact: true }).selectOption("pace");
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
    page.getByRole("heading", { name: "비교할 페이스 구간", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".growth-table")).toContainText("4회");
  await page
    .getByRole("button", { name: "리포트 다운로드", exact: true })
    .click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 저장", exact: true }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe("runograph-report.json");
  const report = await readFile((await download.path())!, "utf8");
  expect(report).not.toContain("test-uuid");
  expect(report).not.toContain("test-0.json");
  expect(JSON.parse(report).sessions).toHaveLength(4);
  await page.getByText("전체 기록 · 4회").click();
  await page.getByLabel("시작 날짜", { exact: true }).fill("2026-01-04");
  await expect(page.locator(".global-filters")).toContainText("1회");
  await page.getByRole("button", { name: "어두운 모드", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "데이터 초기화", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "삼성헬스 ZIP 선택", exact: true }),
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
  const file = page.getByLabel("삼성헬스 ZIP 선택", { exact: true });
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
  await page.getByLabel("삼성헬스 ZIP 선택", { exact: true }).setInputFiles({
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
  await expect(page.getByTestId("timeline")).toHaveCount(3);
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
});
