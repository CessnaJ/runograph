import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("install metadata and every platform icon/startup image are usable", async ({
  page,
  request,
  browserName,
}) => {
  await page.goto("/");
  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  const response = await request.get(manifestHref!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/json|manifest/);
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(new URL(manifest.start_url, page.url()).origin).toBe(
    new URL(page.url()).origin,
  );
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    const png = sharp(await image.body());
    const { width, height, format } = await png.metadata();
    expect(format).toBe("png");
    expect(`${width}x${height}`).toBe(icon.sizes);
    if (icon.purpose === "maskable")
      expect((await png.stats()).isOpaque).toBe(true);
  }
  const appleIcon = await request.get(
    (await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"))!,
  );
  expect(appleIcon.ok()).toBe(true);
  const appleMeta = await sharp(await appleIcon.body()).metadata();
  expect([appleMeta.width, appleMeta.height]).toEqual([180, 180]);
  const startup = await page
    .locator('link[rel="apple-touch-startup-image"]')
    .evaluateAll((links) =>
      links.map((link) => ({
        href: link.getAttribute("href")!,
        media: link.getAttribute("media")!,
      })),
    );
  expect(startup.length).toBeGreaterThan(0);
  for (const { href, media } of startup) {
    const width = Number(media.match(/device-width: (\d+)px/)![1]);
    const height = Number(media.match(/device-height: (\d+)px/)![1]);
    const dpr = Number(media.match(/device-pixel-ratio: (\d+)/)![1]);
    const landscape = media.includes("orientation: landscape");
    const image = await request.get(href);
    expect(image.ok()).toBe(true);
    const meta = await sharp(await image.body()).metadata();
    expect([meta.width, meta.height]).toEqual(
      landscape ? [height * dpr, width * dpr] : [width * dpr, height * dpr],
    );
    expect((await sharp(await image.body()).stats()).isOpaque).toBe(true);
  }
  // Chromium's manifest parser catches browser-level errors beyond JSON validity.
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const parsed = await cdp.send("Page.getAppManifest");
    expect(parsed.errors).toEqual([]);
    expect(parsed.url).toContain("/manifest.webmanifest");
    await cdp.detach();
  }
  await page.getByRole("button", { name: "어두운 모드", exact: true }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#191b18",
  );
  await page.getByRole("button", { name: "밝은 모드", exact: true }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#fffefa",
  );
});

test("launch state is visible before JavaScript and respects system appearance", async ({
  browser,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5197/");
    const launch = page.getByRole("status", { name: "runograph 시작 중" });
    await expect(launch).toBeVisible();
    await expect(launch).toHaveCSS(
      "background-color",
      colorScheme === "dark" ? "rgb(25, 27, 24)" : "rgb(255, 254, 250)",
    );
    await expect(launch.locator("img")).toBeVisible();
    await context.close();
  }
});
