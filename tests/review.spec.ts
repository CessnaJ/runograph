import { expect, test } from "@playwright/test";
import { testZip } from "./fixture";
import { upgradeZip } from "./upgrade-fixture";

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
    page.getByLabel("러닝 파일 불러오기", { exact: true }).setInputFiles({
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
    page.getByRole("button", { name: "러닝 파일 불러오기", exact: true }),
  ).toBeVisible();
  await importZip();
  await page.getByRole("button", { name: "직접 고르기 →" }).click();
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
  await page.getByLabel("러닝 파일 불러오기", { exact: true }).setInputFiles({
    name: "broken.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("invalid archive"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "이번 러닝 돌아보기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "직접 고르기 →" }).click();
  await page
    .getByLabel("비교할 러닝", { exact: true })
    .selectOption({ label: older });
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toContainText("심박은 5 bpm 낮았어요");
  await page.setViewportSize({ width: 320, height: 780 });
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("input, select, label")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth)
      .map((e) => ({
        tag: e.tagName,
        label: e.getAttribute("aria-label"),
        right: e.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.documentWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.viewport,
  );
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
    page.getByRole("button", { name: "러닝 파일 불러오기", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "러닝 파일 불러오기", exact: true }),
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

test("latest evidence, one-click similar comparison, personal range and honest alternative conditions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("러닝 파일 불러오기", { exact: true }).setInputFiles({
    name: "synthetic-upgrade.zip",
    mimeType: "application/zip",
    buffer: await upgradeZip(),
  });
  const recap = page.getByRole("region", { name: "최근 러닝 복기" });
  await expect(recap).toContainText("마지막 3분에 속도를 높였어요");
  await expect(recap.locator(".review-mini-chart")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "내 과거 범위와 오늘의 심박" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /비슷한 .* 기록과 보기/ }).click();
  await expect(
    page.getByRole("region", { name: "두 러닝 비교 결과" }),
  ).toBeVisible();
  await expect(page.getByLabel("비교할 러닝", { exact: true })).not.toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "요약", exact: true }).click();
  await page.getByRole("button", { name: "분석", exact: true }).click();
  await expect(page.getByTestId("comparison-answer")).toHaveAttribute(
    "data-state",
    "insufficient",
  );
  await expect(page.getByLabel("비교 기간", { exact: true })).not.toBeVisible();
  const discovery = page.getByTestId("comparison-discovery");
  await expect(discovery).toContainText("최근 8주 / 이전 8주");
  await expect(discovery).toContainText("이전 8회");
  await expect(discovery).toContainText("최근 10회");
  await discovery.getByRole("button", { name: "이 비교 자세히 보기" }).click();
  await expect(page.getByTestId("comparison-support")).toContainText(
    "이전 8회 · 최근 10회",
  );
  await page.getByText("전체 기록 · 18회").click();
  await page.getByLabel("시작 날짜", { exact: true }).fill("2026-02-01");
  await page.getByLabel("끝 날짜", { exact: true }).fill("2026-03-02");
  await expect(page.getByRole("status")).toContainText("선택한 기록의 날짜 밖");
  await page.getByRole("button", { name: "선택한 기록으로 다시 찾기" }).click();
  await page.getByText("비교 조건 조정", { exact: true }).click();
  await expect(page.getByLabel("비교 기준일", { exact: true })).toHaveValue(
    "2026-03-02",
  );
  await page.setViewportSize({ width: 320, height: 780 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const width = innerWidth;
        return document.documentElement.scrollWidth <= width
          ? null
          : {
              width,
              documentWidth: document.documentElement.scrollWidth,
              elements: [...document.querySelectorAll("body *")]
                .filter((e) => e.getBoundingClientRect().right > width + 1)
                .slice(0, 8)
                .map((e) => ({
                  tag: e.tagName,
                  class: e.getAttribute("class"),
                  right: e.getBoundingClientRect().right,
                })),
            };
      }),
    )
    .toBeNull();
  expect(errors).toEqual([]);
});
