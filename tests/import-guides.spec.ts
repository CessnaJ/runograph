import { expect, test } from "@playwright/test";

test("Phone choice reveals the right apps and each guide links to official export help", async ({
  page,
}) => {
  await page.goto("/");
  const guides = page.getByRole("region", { name: "앱별 내보내기 안내" });
  const iphone = guides.getByRole("button", { name: "아이폰", exact: true });
  const galaxy = guides.getByRole("button", { name: "갤럭시", exact: true });
  const appButtons = guides.getByRole("button", { name: /내보내기 안내$/ });
  await expect(iphone).toHaveAttribute("aria-pressed", "false");
  await expect(galaxy).toHaveAttribute("aria-pressed", "false");
  await expect(appButtons).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "러닝 파일 불러오기", exact: true }),
  ).toBeVisible();

  await iphone.click();
  await expect(iphone).toHaveAttribute("aria-pressed", "true");
  await expect(galaxy).toHaveAttribute("aria-pressed", "false");
  await expect(appButtons).toHaveCount(3);
  await expect(
    guides.getByRole("button", { name: "삼성헬스 내보내기 안내", exact: true }),
  ).toHaveCount(0);

  for (const [app, officialHost] of [
    ["애플 건강", "support.apple.com"],
    ["Strava", "support.strava.com"],
    ["Nike Run Club", "www.nike.com"],
  ] as const) {
    await guides
      .getByRole("button", { name: `${app} 내보내기 안내`, exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: `${app}에서 가져오기` });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("listitem")).toHaveCount(4);
    await expect(modal.getByRole("link")).toHaveAttribute(
      "href",
      new RegExp(`^https://${officialHost.replaceAll(".", "\\.")}/`),
    );
    if (app === "애플 건강")
      await expect(modal).toContainText("현재 러닝 요약만 지원");
    await modal.getByRole("button", { name: "내보내기 안내 닫기" }).click();
    await expect(modal).toHaveCount(0);
  }

  await galaxy.click();
  await expect(galaxy).toHaveAttribute("aria-pressed", "true");
  await expect(iphone).toHaveAttribute("aria-pressed", "false");
  await expect(appButtons).toHaveCount(3);
  await expect(
    guides.getByRole("button", {
      name: "애플 건강 내보내기 안내",
      exact: true,
    }),
  ).toHaveCount(0);
  await guides
    .getByRole("button", { name: "삼성헬스 내보내기 안내", exact: true })
    .click();
  const samsung = page.getByRole("dialog", { name: "삼성헬스에서 가져오기" });
  await expect(samsung).toContainText("개인 데이터 다운로드");
  await expect(samsung.getByRole("link")).toHaveAttribute(
    "href",
    /^https:\/\/www\.samsung\.com\//,
  );
});

test("Export guide traps keyboard focus, closes with Escape or backdrop, and restores the trigger", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "아이폰", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Strava 내보내기 안내",
    exact: true,
  });
  await trigger.click();
  const modal = page.getByRole("dialog", { name: "Strava에서 가져오기" });
  const close = modal.getByRole("button", { name: "내보내기 안내 닫기" });
  const file = modal.getByRole("button", { name: "파일 선택하기" });
  await expect(close).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  await page.keyboard.press("Shift+Tab");
  await expect(file).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("link")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(file).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await trigger.click();
  await expect(modal).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test("Guides fit a 320px screen and both entry points open the same file chooser", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const directChooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "러닝 파일 불러오기", exact: true })
    .click();
  const directInput = (await directChooser).element();
  expect(await directInput.getAttribute("aria-label")).toBe(
    "러닝 파일 불러오기",
  );

  await page.getByRole("button", { name: "갤럭시", exact: true }).click();
  await page
    .getByRole("button", { name: "Nike Run Club 내보내기 안내", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Nike Run Club에서 가져오기",
  });
  const file = modal.getByRole("button", { name: "파일 선택하기" });
  await expect(modal).toBeVisible();
  await expect(file).toBeInViewport();
  expect(
    await modal.evaluate((element) => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      modalWidth: element.getBoundingClientRect().width,
      contentWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
    })),
  ).toMatchObject({
    viewportWidth: 320,
    documentWidth: 320,
  });
  const fits = await modal.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.width <= innerWidth &&
      element.scrollWidth <= element.clientWidth &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight
    );
  });
  expect(fits).toBe(true);
  await modal.getByRole("link").scrollIntoViewIfNeeded();
  await expect(modal.getByRole("link")).toBeInViewport();
  await expect(file).toBeInViewport();

  const guidedChooser = page.waitForEvent("filechooser");
  await file.click();
  const guidedInput = (await guidedChooser).element();
  expect(await guidedInput.getAttribute("aria-label")).toBe(
    "러닝 파일 불러오기",
  );
  expect(
    await guidedInput.evaluate(
      (element, original) => element === original,
      directInput,
    ),
  ).toBe(true);
  await expect(modal).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});
