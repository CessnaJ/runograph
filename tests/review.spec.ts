import { expect, test } from "@playwright/test";
import { testZip } from "./fixture";

test("review, explicit comparison, consent-only storage, reload and removal", async ({
  page,
}) => {
  const errors: string[] = [];
  const transmissions: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !["GET", "HEAD"].includes(r.method()) ||
      (!r.url().startsWith("http://127.0.0.1:5197") &&
        !r.url().startsWith("blob:") &&
        !r.url().startsWith("data:"))
    )
      transmissions.push(r.url());
  });
  await page.goto("/");
  const buffer = await testZip(16, false, "growth");
  const importZip = async () =>
    page.getByLabel("삼성헬스 ZIP 불러오기", { exact: true }).setInputFiles({
      name: "synthetic-review.zip",
      mimeType: "application/zip",
      buffer,
    });
  await importZip();
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "삼성헬스 ZIP 불러오기", exact: true }),
  ).toBeVisible();
  await importZip();
  await page.getByRole("button", { name: "비교할 러닝 고르기 →" }).click();
  await expect(page.getByLabel("비교할 러닝", { exact: true })).toHaveValue("");
  const options = await page
    .getByLabel("비교할 러닝", { exact: true })
    .locator("option")
    .allTextContents();
  const older = options.find((o) => o.startsWith("2026-01-05"))!;
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: older });
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toContainText("심박은 5 bpm 낮았어요");
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toContainText("5:00–20:00");
  await page.screenshot({
    path: `.local/output/review-${test.info().project.name}.png`,
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "비교 러닝 구간 보기 →", exact: true })
    .click();
  await expect(page.getByLabel("구간 시작", { exact: true })).toHaveValue(
    "300",
  );
  await expect(page.getByLabel("구간 끝", { exact: true })).toHaveValue("1200");
  await page
    .getByRole("button", { name: "비교로 돌아가기", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toContainText("심박은 5 bpm 낮았어요");
  await page
    .getByRole("button", { name: "이 기기에 러닝 보관", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "이 기기에 보관 중이에요" }),
  ).toBeVisible();
  await page
    .getByLabel("삼성헬스 ZIP 불러오기", { exact: true })
    .setInputFiles({
      name: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("invalid archive"),
    });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "비교할 러닝 고르기 →" }).click();
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: older });
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toContainText("심박은 5 bpm 낮았어요");
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "기준 러닝 구간 보기 →", exact: true })
    .click();
  await expect(page.getByTestId("timeline")).toHaveCount(2);
  await page
    .getByRole("button", { name: "기기 보관 지우기", exact: true })
    .click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "이 기기에 보관 중이에요" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "기기 보관 지우기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "기기에서 지우고 닫기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "삼성헬스 ZIP 불러오기", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "삼성헬스 ZIP 불러오기", exact: true }),
  ).toBeVisible();
  const storedCount = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("runograph-records", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const counts = await Promise.all(
      ["meta", "details"].map(
        (s) =>
          new Promise<number>((resolve) => {
            const r = db.transaction(s).objectStore(s).count();
            r.onsuccess = () => resolve(r.result);
          }),
      ),
    );
    db.close();
    return counts;
  });
  expect(storedCount).toEqual([0, 0]);
  expect(errors).toEqual([]);
  expect(transmissions).toEqual([]);
});
