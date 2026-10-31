// Keep this first for direct tsx usage; npm scripts also preload it before imports.
import { environmentFiles } from "./src/server/environment";
import { appOrigin,rateLimit } from "./src/server/http-security";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { registerSocketHandlers, startQueuedWorkers } from "./src/server/socket";
import { recoverJobs,drainWorkers } from "./src/server/queue";
import { abortWorkers } from "./src/server/worker-leases";
import { db } from "./src/server/db";
import { assertMockOAuthEnvironment } from "./src/server/mock-oauth";
import { initializeDatabase } from "./src/server/db";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
const port = Number(process.env.PORT ?? 3000);

assertMockOAuthEnvironment();

void initializeDatabase().then(()=>app.prepare()).then(async () => {
  (await recoverJobs());
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
  (await startQueuedWorkers(io));
  httpServer.listen(port, process.env.AGENTROOM_E2E_SERVER_MANAGED === "true" ? "127.0.0.1" : "0.0.0.0", () => console.info(JSON.stringify({ level: "info", event: "server_listening", port, environmentFiles, providersConfigured: { gemini: Boolean(process.env.GEMINI_API_KEY?.trim()), groq: Boolean(process.env.GROQ_API_KEY?.trim()), openai: Boolean(process.env.OPENAI_API_KEY?.trim()) } })));
}).catch(()=>{console.error(JSON.stringify({level:"error",event:"server_startup_failed"}));process.exitCode=1;});
