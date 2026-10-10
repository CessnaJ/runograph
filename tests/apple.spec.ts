import { expect, test } from "@playwright/test";
import { appleXml, appleZip } from "./apple-fixture";

test("Apple summaries: ZIP/XML, comparison, honest limitations, local restore and privacy", async ({
  page,
}) => {
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
  await page.goto("/");
  await expect(
    page.getByText("애플 건강은 시험 지원", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("러닝 파일 불러오기", { exact: true })
    .setInputFiles({
      name: "export.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(await (await appleZip()).arrayBuffer()),
    });
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText(
    "실제 기기의 내보내기 파일은 아직 검증하지 못했어요",
  );
  await expect(
    page.getByRole("region", { name: "최근 러닝 복기" }),
  ).toContainText("145");
  await page.getByRole("button", { name: "비교할 러닝 고르기 →" }).click();
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: "2026-01-01 · 09:00 · 5.00 km" });
  const comparison = page.getByRole("region", { name: "두 러닝 요약 비교" });
  await expect(comparison).toContainText("6:40 /km");
  await expect(comparison).toContainText("8:00 /km");
  await expect(comparison).toContainText("— bpm");
  await expect(comparison).toContainText("아직 지원하지 않아요");
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `.local/output/apple-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "기준 러닝 요약 보기 →", exact: true })
    .click();
  await expect(
    page.getByText("애플 건강에 저장된 요약", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("timeline")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
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
  await expect(page.getByRole("note")).toContainText("시험 단계");
  await page
    .getByRole("button", { name: "러닝 요약 보기 →", exact: true })
    .click();
  await expect(
    page.getByText("애플 건강에 저장된 요약", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("runograph-records", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const content = await Promise.all(
      ["meta", "details"].map(
        (name) =>
          new Promise<unknown>((resolve) => {
            const r = db.transaction(name).objectStore(name).getAll();
            r.onsuccess = () => resolve(r.result);
          }),
      ),
    );
    db.close();
    return JSON.stringify(content);
  });
  for (const secret of [
    "PRIVATE",
    "Synthetic",
    "Watch",
    "sourceName",
    "export.xml",
    "<HealthData",
  ])
    expect(stored).not.toContain(secret);
  await page
    .getByLabel("러닝 파일 불러오기", { exact: true })
    .setInputFiles({
      name: "bad.xml",
      mimeType: "application/xml",
      buffer: Buffer.from("<HealthData><Workout></HealthData>"),
    });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
  await page
    .getByLabel("러닝 파일 불러오기", { exact: true })
    .setInputFiles({
      name: "export.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(appleXml()),
    });
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "최근 러닝 복기" }),
  ).toContainText("145");
  expect(errors).toEqual([]);
  expect(transmissions).toEqual([]);
});
