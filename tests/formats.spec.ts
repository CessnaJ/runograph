import { expect, test, type Page } from "@playwright/test";
import {
  gpxFormatGzip,
  nikeFormatsZip,
  stravaFormatsZip,
} from "./formats-fixture";

function observePrivacy(page: Page) {
  const errors: string[] = [],
    transmissions: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !["GET", "HEAD"].includes(r.method()) ||
      !["http://127.0.0.1:5197", "blob:", "data:"].some((prefix) =>
        r.url().startsWith(prefix),
      )
    )
      transmissions.push(r.url());
  });
  return () => {
    expect(errors).toEqual([]);
    expect(transmissions).toEqual([]);
  };
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await page.getByLabel("러닝 파일 불러오기", { exact: true }).setInputFiles({
    name,
    mimeType: name.endsWith(".gz") ? "application/gzip" : "application/zip",
    buffer,
  });
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
}
async function saveAndReload(page: Page) {
  await page
    .getByRole("button", { name: "이 기기에 러닝 보관", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "이 기기에 보관 중이에요" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
}
async function assertStoredPrivacy(page: Page, detailCount: number) {
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("runograph-records", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await Promise.all(
      ["meta", "details"].map(
        (name) =>
          new Promise<unknown[]>((resolve, reject) => {
            const request = db.transaction(name).objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    db.close();
    return { text: JSON.stringify(values), detailCount: values[1].length };
  });
  expect(saved.detailCount).toBe(detailCount);
  for (const privateValue of [
    "SYNTHETIC-PRIVATE",
    "example.invalid",
    "synthetic-old.tcx",
    "synthetic-new.tcx",
    "synthetic-summary.json",
    "synthetic-timeline.json",
    "37.123456",
    "127.987654",
    "<TrainingCenterDatabase",
    "<gpx",
    "start_epoch_ms",
  ])
    expect(saved.text).not.toContain(privateValue);
}

test("Strava TCX archive: worker analysis, real interval comparison and local detailed restore", async ({
  page,
}) => {
  const checkPrivacy = observePrivacy(page);
  await page.goto("/");
  await upload(page, "synthetic-strava.zip", await stravaFormatsZip());
  await expect(page.getByText("전체 기록 · 2회")).toBeVisible();
  const recap = page.getByRole("region", { name: "최근 러닝 복기" });
  await expect(recap).toContainText("6:00");
  await expect(recap.locator(".review-mini-chart")).toBeVisible();
  await page.getByRole("button", { name: "러닝", exact: true }).click();
  await page.locator(".run-row").first().click();
  await expect(
    page.getByRole("heading", { name: "2026-01-03", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page.getByLabel("측정 시점", { exact: true }).fill("60");
  await expect(page.getByTestId("readout")).toContainText("150");
  await page
    .getByRole("button", { name: "이 러닝과 다른 기록 비교 →", exact: true })
    .click();
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: "2026-01-01 · 09:00 · 5.00 km" });
  const result = page.getByRole("region", { name: "두 러닝 비교 결과" });
  await expect(result).toContainText("심박은 5 bpm 낮았어요");
  await expect(result).toContainText("5:00–20:00");
  await page
    .getByRole("button", { name: "기준 러닝 구간 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await saveAndReload(page);
  await page.getByRole("button", { name: "러닝", exact: true }).click();
  await page.locator(".run-row").first().click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page.getByLabel("측정 시점", { exact: true }).fill("60");
  await expect(page.getByTestId("readout")).toContainText("150");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await assertStoredPrivacy(page, 2);
  checkPrivacy();
});

test("Nike mixed archive: summary-only runs stay usable beside a detailed run before and after restore", async ({
  page,
}) => {
  const checkPrivacy = observePrivacy(page);
  await page.goto("/");
  await upload(page, "synthetic-nike.zip", await nikeFormatsZip());
  await expect(
    page.getByRole("region", { name: "최근 러닝 복기" }),
  ).toContainText("러닝 요약만 볼 수 있어요");
  await page
    .getByRole("button", { name: "러닝 요약 보기 →", exact: true })
    .click();
  await expect(
    page.getByText("Nike Run Club에 저장된 요약", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("timeline")).toHaveCount(0);
  await expect(
    page.getByText("이 파일에는 시간별 측정값이 없어", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "이 러닝과 다른 기록 비교 →", exact: true })
    .click();
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: "2026-01-01 · 09:00 · 5.00 km" });
  const summary = page.getByRole("region", { name: "두 러닝 요약 비교" });
  await expect(summary).toContainText("148 bpm");
  await expect(summary).toContainText("153 bpm");
  await expect(summary).toContainText("6:00 /km");
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "비교 러닝 요약 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page.getByLabel("측정 시점", { exact: true }).fill("60");
  await expect(page.getByTestId("readout")).toContainText("153");
  await saveAndReload(page);
  await page
    .getByRole("button", { name: "러닝 요약 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "이 러닝과 다른 기록 비교 →", exact: true })
    .click();
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: "2026-01-01 · 09:00 · 5.00 km" });
  await expect(
    page.getByRole("region", { name: "두 러닝 요약 비교" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "비교 러닝 요약 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await assertStoredPrivacy(page, 1);
  checkPrivacy();
});

test("gzip GPX: observed heart rate survives while missing distance and pace remain unavailable", async ({
  page,
}) => {
  const checkPrivacy = observePrivacy(page);
  await page.goto("/");
  await upload(page, "synthetic-run.gpx.gz", gpxFormatGzip());
  const stats = page
    .getByRole("region", { name: "최근 러닝 복기" })
    .locator(".recap-stats");
  await expect(stats.locator("strong").nth(0)).toHaveText("—");
  await expect(stats.locator("strong").nth(1)).toHaveText("30분");
  await expect(stats.locator("strong").nth(2)).toHaveText("—");
  await page
    .getByRole("button", { name: "러닝 그래프 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page.getByLabel("측정 시점", { exact: true }).fill("60");
  const readout = page.getByTestId("readout");
  await expect(readout).toContainText("151");
  await expect(
    readout
      .locator(".readout-values > span")
      .filter({ hasText: "페이스" })
      .locator("b"),
  ).toHaveText("—");
  await saveAndReload(page);
  await page
    .getByRole("button", { name: "러닝 그래프 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page.getByLabel("측정 시점", { exact: true }).fill("60");
  await expect(page.getByTestId("readout")).toContainText("151");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await assertStoredPrivacy(page, 1);
  checkPrivacy();
});
