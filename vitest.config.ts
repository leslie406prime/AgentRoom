import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { env: { DATABASE_PATH: ":memory:", OPENAI_MODEL: "gpt-4o-mini", OPENAI_API_KEY: "", AVATAR_DIRECTORY: "./data/test-avatars" }, environment: "node", testTimeout: 15000, include: ["tests/**/*.test.ts"] },
});
