import Database from "better-sqlite3";
import path from "node:path";

// These fixtures must never open or replace the user's application database.
export function testDatabase() {
  const configured = process.env.DATABASE_PATH;
  if (process.env.AUTH_MOCK_OAUTH_ENABLED !== "true" || !configured ||
      path.resolve(configured) === path.resolve("data/agentroom.sqlite")) {
    throw new Error("Browser fixtures require the existing isolated test database.");
  }
  const database = new Database(path.resolve(configured), { fileMustExist: true });
  database.pragma("foreign_keys=ON");
  database.pragma("busy_timeout=5000");
  return database;
}
