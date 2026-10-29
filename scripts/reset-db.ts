import fs from "node:fs";
import path from "node:path";

const filename = process.env.DATABASE_PATH ?? "./data/agentroom.sqlite";
if (filename === ":memory:") {
  console.info("The in-memory database is reset when the server stops.");
} else {
  const resolved = path.resolve(filename);
  for (const candidate of [resolved, `${resolved}-wal`, `${resolved}-shm`]) {
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
  }
  console.info(`Removed local AgentRoom database: ${resolved}`);
}
