import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");
const environmentModule = pathToFileURL(path.resolve("src/server/environment.ts")).href;
const baseSecret = "base-" + "b".repeat(40);
const localSecret = "local-" + "l".repeat(40);
const inheritedSecret = "inherited-" + "i".repeat(40);

function preload(files: Record<string, string>, expected: string, inherited?: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agentroom-environment-"));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", EXPECTED_TEST_SECRET: expected };
  for (const key of Object.keys(env)) {
    if (/^(AUTH_|NEXTAUTH_|__NEXT_PROCESSED_ENV|AGENTROOM_E2E_)/.test(key)) delete env[key];
  }
  if (inherited !== undefined) Object.assign(env, { AUTH_SECRET: inherited });
  try {
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(directory, name), contents);
    // The entry point imports no loader itself: Node must finish the preload first.
    return spawnSync(process.execPath, [
      tsx, "--import", environmentModule, "-e",
      'console.log(JSON.stringify({entryReached:true,secretMatches:process.env.AUTH_SECRET===process.env.EXPECTED_TEST_SECRET}))',
    ], { cwd: directory, env, encoding: "utf8", timeout: 12000 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it("loads the base environment before the entry point executes", () => {
  const result = preload({ ".env": "AUTH_SECRET=" + baseSecret }, baseSecret);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ entryReached: true, secretMatches: true });
});

it("lets .env.local override an empty base AUTH_SECRET", () => {
  const result = preload({ ".env": "AUTH_SECRET=", ".env.local": "AUTH_SECRET=" + localSecret }, localSecret);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).secretMatches).toBe(true);
});

it("preserves Next.js development-file precedence", () => {
  const result = preload({
    ".env": "AUTH_SECRET=" + baseSecret,
    ".env.local": "AUTH_SECRET=" + localSecret,
    ".env.development.local": "AUTH_SECRET=" + inheritedSecret,
  }, inheritedSecret);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).secretMatches).toBe(true);
});

it("preserves a valid inherited secret instead of replacing it with file values", () => {
  const result = preload({ ".env.local": "AUTH_SECRET=" + localSecret }, inheritedSecret, inheritedSecret);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).secretMatches).toBe(true);
});

it.each(["", "AUTH_SECRET=", 'AUTH_SECRET="   "', "AUTH_SECRECT=" + baseSecret])(
  "fails before the entry point when AUTH_SECRET is absent or empty (%#)", contents => {
    const result = preload({ ".env": contents }, "");
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("entryReached");
    expect(result.stderr).toContain("Set AUTH_SECRET to at least 32 random characters");
  },
);

it("reports an empty inherited override rather than silently changing precedence", () => {
  const result = preload({ ".env.local": "AUTH_SECRET=" + localSecret }, "", "");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Existing environment variables take precedence");
});
