// Import before database modules so even an accidental direct invocation is safe.
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.AGENTROOM_POSTGRES_TEST !== "true" || url.hostname !== "127.0.0.1" || url.pathname !== "/agentroom_test") {
  throw new Error("PostgreSQL tests require the isolated local test harness.");
}
export {};
