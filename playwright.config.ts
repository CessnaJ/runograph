import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5197",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run preview -- --port 5197 --strictPort",
    url: "http://127.0.0.1:5197",
    reuseExistingServer: !process.env.CI,
  },
});
