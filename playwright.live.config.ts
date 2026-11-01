import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  globalSetup: "./tests/live-app/setup.ts",
  testDir: "./tests/live-app", workers: 1, timeout: 420000,
  expect: { timeout: 120000 },
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3101", trace: "off" },
});
