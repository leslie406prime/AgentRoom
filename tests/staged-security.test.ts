import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("rejects staged local data and credentials while allowing safe source and the environment example", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agentroom-staged-scan-"));
  const require = createRequire(import.meta.url);
  const runner = require.resolve("tsx/cli");
  const scanner = path.resolve("scripts/check-staged-security.ts");
  const secret = "staged-test-only-" + "x".repeat(32);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "pipe" });
  const scan = () => spawnSync(process.execPath, [runner, scanner], { cwd: directory, windowsHide: true, encoding: "utf8", timeout: 20000, env: { ...process.env, AUTH_SECRET: secret } });
  try {
    git("init", "--quiet");
    writeFileSync(path.join(directory, ".env.example"), "AUTH_SECRET=\nGEMINI_API_KEY=\n");
    writeFileSync(path.join(directory, "safe.ts"), "export const safe = true;\n");
    git("add", ".env.example", "safe.ts");
    const clean = scan(); expect(clean.status, clean.stderr).toBe(0);
    writeFileSync(path.join(directory, ".env.local"), "AUTH_SECRET=" + secret);
    writeFileSync(path.join(directory, "data.sqlite"), "test database placeholder");
    writeFileSync(path.join(directory, "notes.txt"), secret);
    writeFileSync(path.join(directory, "credential.txt"), "gsk_" + "a".repeat(45));
    git("add", ".env.local", "data.sqlite", "notes.txt", "credential.txt");
    const unsafe = scan(); expect(unsafe.status).not.toBe(0);
    expect(unsafe.stderr).toContain("prohibited secret/data path");
    expect(unsafe.stderr).toContain("contains configured AUTH_SECRET");
    expect(unsafe.stderr).toContain("probable provider credential");
    expect(unsafe.stderr).not.toContain(secret);
  } finally {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("agentroom-staged-scan-")) throw new Error("Unexpected test cleanup path.");
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);
