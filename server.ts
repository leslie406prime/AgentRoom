// Keep this first for direct tsx usage; npm scripts also preload it before imports.
import { environmentFiles } from "./src/server/environment";
import { createServer } from "node:http";
import { logStartupFailure, startupStage } from "./src/server/startup-diagnostics";

const startupCleanup: (() => Promise<unknown>)[] = [];
async function start() {
const { dev, port, appOrigin, rateLimit } = await startupStage("configuration", async () => {
  const security = await import("./src/server/http-security");
  return { dev: process.env.NODE_ENV !== "production", port: Number(process.env.PORT ?? 3000), ...security };
});
const { db, initializeDatabase, checkDatabaseHealth } = await startupStage("database_initialization", () => import("./src/server/db"));
startupCleanup.push(() => db.close());
await startupStage("database_connection", () => checkDatabaseHealth());
await startupStage("migration", () => initializeDatabase());
const app = await startupStage("server_initialization", async () => {
  const { default: next } = await import("next");
  return next({ dev });
});
startupCleanup.push(() => app.close());
await startupStage("next_preparation", () => app.prepare());
// Next must initialize its Node runtime before modules using next/headers load.
await startupStage("authentication_initialization", () => import("./src/auth"));
const { registerSocketHandlers, startQueuedWorkers, recoverJobs, drainWorkers, abortWorkers, Server } = await startupStage("server_initialization", async () => {
  const sockets = await import("./src/server/socket");
  const queue = await import("./src/server/queue");
  const leases = await import("./src/server/worker-leases");
  const socketIO = await import("socket.io");
  return { ...sockets, ...queue, ...leases, Server: socketIO.Server };
});
startupCleanup.push(async () => { await drainWorkers(25000);abortWorkers(); });
await startupStage("job_recovery", () => recoverJobs());
const { httpServer, io } = await startupStage("server_initialization", () => {
  const handle = app.getRequestHandler();

  const httpServer = createServer((req, res) => {
    if (dev && process.env.AGENTROOM_E2E_SERVER_MANAGED === "true" && req.url === "/__agentroom_test_shutdown" && req.method === "POST") {
      const expected = process.env.AGENTROOM_TEST_SHUTDOWN_TOKEN;
      if (!expected || req.headers["x-agentroom-test-shutdown"] !== expected || req.headers.origin !== new URL(process.env.AUTH_URL ?? "http://localhost:3000").origin) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"ok":true}');
      setImmediate(() => {
        void shutdown().catch(() => process.exit(1));
      });
      return;
    }
    const pathname=(req.url??"/").split("?")[0];
    if(pathname.startsWith("/api/auth/signin")||pathname.startsWith("/api/auth/callback")||pathname.startsWith("/api/mock-oauth/authorize")){
      try{rateLimit((pathname.startsWith("/api/mock-oauth/")?"mock-authorize:":pathname.startsWith("/api/auth/callback")?"callback:":"signin:")+(req.socket.remoteAddress??"unknown"),30);}catch{res.writeHead(429,{"content-type":"application/json","cache-control":"no-store","retry-after":"60"});res.end('{"error":"Too many sign-in attempts. Please wait."}');return;}
    }
    void handle(req, res);
  });
  const io = new Server(httpServer, {
    cors: { origin: appOrigin(), credentials: true },
    allowRequest: (request, callback) => callback(null, !request.headers.origin || request.headers.origin === appOrigin()),
    maxHttpBufferSize: 1e6,
  });
  startupCleanup.push(async () => { io.close();httpServer.closeAllConnections(); });
  registerSocketHandlers(io);
  let shuttingDown=false;
  const shutdown=async()=>{
    if(shuttingDown)return;shuttingDown=true;
    const forced=setTimeout(()=>process.exit(1),30000);forced.unref();
    console.info(JSON.stringify({level:"info",event:"server_draining"}));
    httpServer.close();io.disconnectSockets(true);
    await drainWorkers(25000);abortWorkers();
    await new Promise(resolve=>setTimeout(resolve,100));
    io.close();httpServer.closeAllConnections();await app.close();await db.close();
    clearTimeout(forced);process.exit(0);
  };
  process.once("SIGTERM",()=>void shutdown().catch(()=>process.exit(1)));
  process.once("SIGINT",()=>void shutdown().catch(()=>process.exit(1)));
  return { httpServer, io };
});
  await startupStage("worker_startup", () => startQueuedWorkers(io));
  await startupStage("port_binding", () => new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { httpServer.off("listening", listening);reject(error); };
    const listening = () => { httpServer.off("error", failed);resolve(); };
    httpServer.once("error", failed);httpServer.once("listening", listening);
    httpServer.listen(port, process.env.AGENTROOM_E2E_SERVER_MANAGED === "true" ? "127.0.0.1" : "0.0.0.0");
  }));
  console.info(JSON.stringify({ level: "info", event: "server_listening", port, environmentFiles, providersConfigured: { gemini: Boolean(process.env.GEMINI_API_KEY?.trim()), groq: Boolean(process.env.GROQ_API_KEY?.trim()), openai: Boolean(process.env.OPENAI_API_KEY?.trim()) } }));
}
void start().catch(async error => {
  logStartupFailure(error);process.exitCode = 1;
  for (const cleanup of startupCleanup.reverse()) { try { await cleanup(); } catch { console.error(JSON.stringify({ level: "error", event: "server_startup_cleanup_failed" })); } }
});
