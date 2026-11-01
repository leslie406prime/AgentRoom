import { loadEnvConfig } from "@next/env";
import { assertMockOAuthEnvironment } from "./mock-oauth";
import { logStartupFailure } from "./startup-diagnostics";
let environmentFiles: string[] = [];
try {
const loadedEnvironment = loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
environmentFiles = loadedEnvironment.loadedEnvFiles.map(file => file.path);
assertMockOAuthEnvironment();
if(!process.env.AUTH_SECRET || process.env.AUTH_SECRET.trim().length < 32) throw new Error("Set AUTH_SECRET to at least 32 random characters in the project-root .env.local or server environment. Existing environment variables take precedence over .env files.");
if(process.env.NODE_ENV==="production"&&!process.env.AUTH_URL)throw new Error("Set AUTH_URL to the canonical application origin.");
if(process.env.NODE_ENV==="production"&&!process.env.DATABASE_URL)throw new Error("Production requires DATABASE_URL for PostgreSQL; SQLite fallback is disabled.");
if(process.env.NODE_ENV==="production"&&process.env.AGENTROOM_BUILD_ONLY==="true")throw new Error("Build-only database mode cannot start a production server.");
if(process.env.NODE_ENV==="production"&&process.env.AGENTROOM_E2E_SERVER_MANAGED==="true")throw new Error("The test server cannot run in production.");
const origin=new URL(process.env.AUTH_URL ?? "http://localhost:"+(process.env.PORT??"3000"));
if(!["http:","https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname!=="/" || origin.search || origin.hash) throw new Error("AUTH_URL must be the application origin.");
} catch(error) {
  logStartupFailure(error, "configuration");
  // Fixed validation messages are safe; URL parser errors may retain their input.
  const safeMessages = ["Set AUTH_SECRET to at least 32 random characters in the project-root .env.local or server environment. Existing environment variables take precedence over .env files.", "Set AUTH_URL to the canonical application origin.", "Production requires DATABASE_URL for PostgreSQL; SQLite fallback is disabled.", "Build-only database mode cannot start a production server.", "The test server cannot run in production.", "AUTH_URL must be the application origin.", "AUTH_MOCK_OAUTH_ENABLED cannot be enabled in production."];
  throw new Error(error instanceof Error && safeMessages.includes(error.message) ? error.message : "Server configuration could not be initialized.");
}
export { environmentFiles };
