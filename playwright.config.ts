import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  globalSetup: "./tests/e2e/setup.ts",
  testDir: "./tests/e2e",
  timeout: 180000,
  workers: 1,
  expect: { timeout: 60000 },
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3000", trace: "off" },
  webServer: process.env.AGENTROOM_E2E_SERVER_MANAGED === "true" ? undefined : {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_MOCK_OAUTH_ENABLED: "true",
      AUTH_SECRET: "agentroom-playwright-test-secret",
      AUTH_URL: "http://localhost:3000",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "gpt-4o-mini",
      WORKSPACE_CREDENTIAL_KEY: Buffer.alloc(32,7).toString("base64"),
      AVATAR_DIRECTORY: "./data/e2e-avatars",
      DATABASE_PATH: "./data/agentroom-e2e.sqlite",
      PORT: "3000",
    },
  },
});
