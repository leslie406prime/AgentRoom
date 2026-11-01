import { afterEach, expect, it, vi } from "vitest";
import { Client } from "pg";
import { DatabaseAccess } from "../src/server/database-access";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => vi.unstubAllEnvs());
it("requires PostgreSQL in production and does not open a SQLite fallback", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AGENTROOM_BUILD_ONLY", "");
  vi.stubEnv("DATABASE_URL", "");
  expect(() => new DatabaseAccess()).toThrow("Production requires DATABASE_URL");
});
it("retains certificate verification despite PostgreSQL URL SSL overrides", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@example.invalid/test?ssl=0&sslmode=require&uselibpqcompat=true");
  const remote = new DatabaseAccess();
  try {
    expect(remote.kind).toBe("postgres");
    expect(remote.sqlite).toBeUndefined();
    expect(remote.pool!.options.statement_timeout).toBeUndefined();
    expect(remote.pool!.options.query_timeout).toBe(20000);
    const client = new Client(remote.pool!.options);
    expect(client).toHaveProperty("ssl", { rejectUnauthorized: true });
    await client.end();
  } finally { await remote.close(); }
});
it("rejects explicitly disabled remote TLS", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@example.invalid/test?sslmode=disable");
  expect(() => new DatabaseAccess()).toThrow("Remote PostgreSQL requires TLS");
});
it("keeps development SQLite durable using only a new temporary fixture", async () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "agentroom-sqlite-check-"));
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DATABASE_PATH", path.join(folder, "fixture.sqlite"));
  let local: DatabaseAccess | undefined;
  try {
    local = new DatabaseAccess();
    expect(local.kind).toBe("sqlite");
    await local.prepare("INSERT INTO rooms(id,name) VALUES (?,?)").run("sqlite-fixture", "Preserved development");
    await local.close();local = undefined;
    local = new DatabaseAccess();
    expect(await local.prepare("SELECT name FROM rooms WHERE id=?").get("sqlite-fixture")).toEqual({ name: "Preserved development" });
  } finally {
    await local?.close();
    if(path.dirname(folder)!==path.resolve(os.tmpdir())||!path.basename(folder).startsWith("agentroom-sqlite-check-"))throw new Error("Unexpected fixture cleanup path.");
    rmSync(folder,{recursive:true,force:true});
  }
});
