// Deterministic vector-to-PNG exports. No user data, network requests or AI calls.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const ROOT = new URL("../", import.meta.url);
const resolve = (path: string) => fileURLToPath(new URL(path, ROOT));
const icon = await readFile(resolve("public/icons/icon.svg"), "utf8");
const fullBleed = icon.replace('rx="112"', 'rx="0"');
await mkdir(resolve("public/splash"), { recursive: true });
for (const size of [32, 192, 512, 1024, 2048])
  await sharp(Buffer.from(icon), { density: Math.max(72, (size / 512) * 72) })
    .resize(size, size)
    .png()
    .toFile(resolve(`public/icons/icon-${size}.png`));
await sharp(Buffer.from(fullBleed), { density: 72 })
  .resize(512, 512)
  .png()
  .toFile(resolve("public/icons/icon-maskable-512.png"));
await sharp(Buffer.from(fullBleed), { density: 72 })
  .resize(180, 180)
  .png()
  .toFile(resolve("public/icons/apple-touch-icon.png"));
const brandPaths = icon.match(/<g[\s\S]*<\/g>/)![0];
function splashSvg(w: number, h: number, dpr: number, dark = false) {
  const bg = dark ? "#191b18" : "#fffefa",
    ink = dark ? "#edf1e7" : "#27352c",
    muted = dark ? "#b2bead" : "#626e61";
  const scale = dpr,
    markSize = 76 * scale,
    center = w / 2,
    markY = h / 2 - 110 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/><svg x="${center - markSize / 2}" y="${markY}" width="${markSize}" height="${markSize}" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#506846"/>${brandPaths}</svg><text x="${center}" y="${markY + markSize + 38 * scale}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${30 * scale}" font-weight="600" letter-spacing="${-0.9 * scale}" fill="${ink}">runograph</text><text x="${center}" y="${markY + markSize + 63 * scale}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${8 * scale}" letter-spacing="${1.9 * scale}" fill="${muted}">YOUR RUNNING JOURNAL</text></svg>`;
}
// CSS screen sizes, not claims about specific device models. Every variant gets
// an exact physical-pixel size; unmatched devices still have the HTML launch state.
const screens: [number, number, number][] = [
  [375, 667, 2],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [414, 896, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
  [768, 1024, 2],
  [820, 1180, 2],
  [834, 1194, 2],
  [1024, 1366, 2],
];
const links: string[] = [];
for (const [width, height, dpr] of screens) {
  for (const orientation of ["portrait", "landscape"] as const) {
    const w = (orientation === "portrait" ? width : height) * dpr,
      h = (orientation === "portrait" ? height : width) * dpr;
    const name = `launch-${w}x${h}.png`;
    await sharp(Buffer.from(splashSvg(w, h, dpr)))
      .png()
      .toFile(resolve(`public/splash/${name}`));
    links.push(
      `<link rel="apple-touch-startup-image" href="/splash/${name}" media="(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})" />`,
    );
  }
}
// Editable high-resolution source and a general-purpose 2160×3840 design master.
for (const dark of [false, true]) {
  const suffix = dark ? "-dark" : "";
  const svg = splashSvg(2160, 3840, 6, dark);
  await writeFile(resolve(`public/splash/launch-master${suffix}.svg`), svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(resolve(`public/splash/launch-master${suffix}.png`));
}
const htmlPath = resolve("index.html");
const html = await readFile(htmlPath, "utf8");
const block = `<!-- PWA_STARTUP_IMAGES_START -->\n${links.join("\n")}\n<!-- PWA_STARTUP_IMAGES_END -->`;
if (!html.includes("<!-- PWA_STARTUP_IMAGES_START -->"))
  throw new Error("index.html startup image markers are missing.");
await writeFile(
  htmlPath,
  html.replace(
    /<!-- PWA_STARTUP_IMAGES_START -->[\s\S]*?<!-- PWA_STARTUP_IMAGES_END -->/,
    block,
  ),
);
console.log(
  "PWA assets generated: SVG + PNG icons, 26 iOS launch sizes, light/dark 2160×3840 masters.",
);
