import {expect,it,afterAll,afterEach,vi} from "vitest";
const sdk=vi.hoisted(()=>({gemini:vi.fn(),groq:vi.fn()}));
vi.mock("@google/genai",()=>({GoogleGenAI:class{models={generateContentStream:sdk.gemini};}}));
vi.mock("groq-sdk",()=>({default:class{chat={completions:{create:sdk.groq}};}}));
import {randomUUID} from "node:crypto";
import {db,initializeDatabase} from "../../src/server/db";
import {authAdapter} from "../../src/server/auth-adapter";
import {createWorkspace,createInvitation,acceptInvitation} from "../../src/server/workspace-repository";
import {createChannel} from "../../src/server/channel-repository";
import {joinMember,sendChannelMessage,channelSnapshot,saveChannelArtifact} from "../../src/server/collaboration-repository";
import {enqueueChannelAgent,persistAgentResponse} from "../../src/server/collaboration-repository";
import {claimNextJob,recoverJobs,updateJob,ensureWorker,drainWorkers} from "../../src/server/queue";
import {DatabaseAccess} from "../../src/server/database-access";
import {migratePostgres} from "../../src/server/postgres-migrations";
import {workerId,requireJobLease} from "../../src/server/worker-leases";
import {saveWorkspaceAvatar,readWorkspaceAvatar} from "../../src/server/avatar-repository";
import sharp from "sharp";
import type {Server} from "socket.io";
import {runAgent} from "../../src/server/agent-worker";
import {loadConfig,updateAIConfig} from "../../src/server/ai-workspace";
import {resetProviderGuards} from "../../src/server/ai-providers";
import {jobAI,reserveUsage,updateAISettings} from "../../src/server/ai-repository";
afterEach(()=>{vi.unstubAllEnvs();resetProviderGuards();});
afterAll(async()=>{await drainWorkers();await db.close()});
it("initializes an empty versioned schema and preserves data through new connections",async()=>{
 expect((await db.prepare('SELECT count(*) AS n FROM "user"').get())!.n).toBe(0);
 await initializeDatabase();expect((await db.prepare("SELECT count(*) AS n FROM postgres_migrations").get())!.n).toBe(1);
 expect(await db.transaction(async()=> (await db.prepare("SELECT current_setting('statement_timeout') AS timeout").get())!.timeout).immediate()).toBe("15s");
 const user=await authAdapter.createUser!({id:randomUUID(),email:"owner@example.test",emailVerified:new Date(),name:"Owner"});
 const workspace=await createWorkspace(user.id,{name:"Postgres workspace"});
 await joinMember(user.id,workspace.id,workspace.channelId);
 const channel=await createChannel(user.id,workspace.id,{name:"Project Notes"});expect(channel.id).toBeTruthy();
 const writes=await Promise.all(Array.from({length:12},(_,i)=>sendChannelMessage(user.id,workspace.id,workspace.channelId,{clientId:randomUUID(),content:"Message "+i})));
 expect(new Set(writes.map(x=>x.seq)).size).toBe(12);
 const state=await channelSnapshot(user.id,workspace.id,workspace.channelId);expect(state.messages).toHaveLength(12);expect(state.replay).toHaveLength(12);
 const artifact=await saveChannelArtifact(user.id,workspace.id,workspace.channelId,{title:"Notes",type:"document",language:"markdown",content:"Durable",version:0});expect(artifact.type).toBe("artifact");
 const second=await authAdapter.createUser!({id:randomUUID(),email:"member@example.test",emailVerified:null,name:"Member"});
 const invitation=await createInvitation(user.id,workspace.id,{maxUses:1});await acceptInvitation(second.id,invitation.path.split("/").at(-1)!);
 await expect(createChannel(second.id,workspace.id,{name:"forbidden"})).rejects.toThrow("not allowed");
 await authAdapter.linkAccount!({userId:user.id,type:"oauth",provider:"google",providerAccountId:"google-"+user.id});
 expect((await authAdapter.getUserByAccount!({provider:"google",providerAccountId:"google-"+user.id}))!.id).toBe(user.id);
 const session=await authAdapter.createSession!({sessionToken:randomUUID(),userId:user.id,expires:new Date(Date.now()+60000)});
 expect((await authAdapter.getSessionAndUser!(session.sessionToken))!.user.id).toBe(user.id);
 const client=await db.pool!.connect();try{expect((await client.query('SELECT count(*) AS n FROM messages')).rows[0].n).toBe(12)}finally{client.release()}
});

it("runs Gemini, Groq and Muse through the real PostgreSQL queue with usage and replay",async()=>{
 vi.stubEnv("GEMINI_API_KEY","test-postgres-gemini");vi.stubEnv("GROQ_API_KEY","test-postgres-groq");
 sdk.gemini.mockImplementation(async function*(){yield {candidates:[{content:{parts:[{text:"Gemini PostgreSQL response"}]}}],usageMetadata:{promptTokenCount:15,candidatesTokenCount:7}}});
 sdk.groq.mockImplementation(async function*(){yield {choices:[{delta:{content:"Groq PostgreSQL response"}}],usage:{prompt_tokens:20,completion_tokens:8}}});
 const user=await authAdapter.createUser!({id:randomUUID(),email:"ai@example.test",emailVerified:null,name:"AI owner"});const w=await createWorkspace(user.id,{name:"AI persistence"});await joinMember(user.id,w.id,w.channelId);
 const cfg=await loadConfig(w.id);await updateAIConfig(user.id,w.id,{...cfg,museModel:"groq:openai/gpt-oss-20b"});
 const emitted:{name:string;payload:unknown}[]=[],io={to:()=>({emit:(name:string,payload:unknown)=>{emitted.push({name,payload})}})} as unknown as Server;
 const jobs=[];for(const agent of ["gemini","groq","muse"] as const)jobs.push((await enqueueChannelAgent(user.id,w.id,w.channelId,{agent,prompt:"Reply briefly",idempotencyKey:randomUUID()})).result.job);
 ensureWorker(io,w.channelId,runAgent);
 await vi.waitFor(async()=>{expect((await db.prepare("SELECT count(*) AS n FROM agent_jobs WHERE room_id=? AND status='completed'").get(w.channelId))!.n).toBe(3)},{timeout:15000});
 const state=await channelSnapshot(user.id,w.id,w.channelId),replies=state.messages.filter(m=>m.kind==="agent");expect(replies.map(m=>m.jobId)).toEqual(jobs.map(j=>j.id));expect(replies.map(m=>m.provider)).toEqual(["gemini","groq","groq"]);
 expect((await db.prepare("SELECT SUM(input_tokens+output_tokens) AS n FROM usage_records WHERE workspace_id=?").get(w.id))!.n).toBe(78);
 expect(state.replay.filter(e=>e.type==="message")).toHaveLength(6);expect(emitted.some(e=>e.name==="agent:token")).toBe(true);
 await updateAIConfig(user.id,w.id,{...cfg,userHourlyLimit:1});
 await expect(enqueueChannelAgent(user.id,w.id,w.channelId,{agent:"gemini",prompt:"over limit",idempotencyKey:randomUUID()})).rejects.toThrow("limit");
});

it("fences stale workers, preserves FIFO and does not reclaim another live worker",async()=>{
 const user=await authAdapter.createUser!({id:randomUUID(),email:"queue@example.test",emailVerified:null,name:"Queue owner"});
 const w=await createWorkspace(user.id,{name:"Queue safety"});await joinMember(user.id,w.id,w.channelId);
 const first=(await enqueueChannelAgent(user.id,w.id,w.channelId,{prompt:"first",agent:"agent",idempotencyKey:randomUUID()})).result.job;
 const second=(await enqueueChannelAgent(user.id,w.id,w.channelId,{prompt:"second",agent:"agent",idempotencyKey:randomUUID()})).result.job;
 const claims=await Promise.all([claimNextJob(w.channelId),claimNextJob(w.channelId)]);expect(claims.filter(Boolean)).toHaveLength(1);expect(claims.find(Boolean)!.id).toBe(first.id);
 await recoverJobs();expect((await db.prepare("SELECT status,worker_id FROM agent_jobs WHERE id=?").get(first.id))).toEqual({status:"running",worker_id:workerId});
 // A different live process owns the row: the current worker cannot commit its response.
 await db.prepare("UPDATE agent_jobs SET worker_id=? WHERE id=?").run("different-live-worker",first.id);
 await expect(requireJobLease(first.id)).rejects.toThrow("owned by another worker");
 await expect(persistAgentResponse(first,"must not persist","environment")).rejects.toThrow("owned by another worker");
 expect(await claimNextJob(w.channelId)).toBeUndefined();
 await db.prepare("UPDATE agent_jobs SET lease_expires_at=0 WHERE id=?").run(first.id);
 await recoverJobs();expect((await db.prepare("SELECT status FROM agent_jobs WHERE id=?").get(first.id))!.status).toBe("failed");
 expect((await claimNextJob(w.channelId))!.id).toBe(second.id);await updateJob(w.channelId,second.id,"completed");
 expect((await channelSnapshot(user.id,w.id,w.channelId)).messages.filter(m=>m.kind==="agent")).toHaveLength(0);
});

it("serializes concurrent quota reservations across PostgreSQL channels",async()=>{
 vi.stubEnv("GEMINI_API_KEY","test-postgres-gemini");
 const user=await authAdapter.createUser!({id:randomUUID(),email:"quota@example.test",emailVerified:null,name:"Quota owner"});
 const w=await createWorkspace(user.id,{name:"Concurrent quota"}),second=await createChannel(user.id,w.id,{name:"Second"});
 await joinMember(user.id,w.id,w.channelId);await joinMember(user.id,w.id,second.id);
 await updateAISettings(user.id,w.id,{approvedModels:["gpt-4o-mini"],pricing:{"gpt-4o-mini":{input:0.15,output:0.6}},monthlyTokenLimit:2500,monthlySpendUsd:0});
 const jobs=await Promise.all([w.channelId,second.id].map(async channel=>(await enqueueChannelAgent(user.id,w.id,channel,{agent:"gemini",prompt:"Bounded quota",idempotencyKey:randomUUID()})).result.job));
 const configs=await Promise.all(jobs.map(job=>jobAI(job)));
 const reservations=await Promise.allSettled(jobs.map((job,i)=>reserveUsage(job,configs[i],1000)));
 expect(reservations.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 const failed=reservations.find(r=>r.status==="rejected") as PromiseRejectedResult;
 expect(failed.reason.message).toContain("insufficient remaining quota");
 expect((await db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE workspace_id=?").get(w.id))!.n).toBe(1);
});

it("stores authenticated avatar bytes in PostgreSQL and rolls back failed nested transactions",async()=>{
 const user=await authAdapter.createUser!({id:randomUUID(),email:"avatar@example.test",emailVerified:null,name:"Avatar owner"});
 const w=await createWorkspace(user.id,{name:"Durable avatar"});
 const png=await sharp({create:{width:3,height:3,channels:3,background:"purple"}}).png().toBuffer();
 await saveWorkspaceAvatar(user.id,w.id,png);expect((await sharp(await readWorkspaceAvatar(user.id,w.id)).metadata()).format).toBe("webp");
 const peer=new DatabaseAccess();try{expect((await peer.prepare("SELECT count(*) AS n FROM workspace_avatar_blobs").get())!.n).toBe(1);}finally{await peer.close()}
 await expect(db.transaction(async()=>{await createWorkspace(user.id,{name:"Rolled back"});throw new Error("rollback");}).immediate()).rejects.toThrow("rollback");
 expect((await db.prepare("SELECT count(*) AS n FROM workspaces WHERE name=?").get("Rolled back"))!.n).toBe(0);
 await expect(db.pool!.query("UPDATE postgres_migrations SET checksum='invalid' WHERE version=1").then(()=>migratePostgres(db.pool!))).rejects.toThrow("checksum changed");
 // Test cluster is disposable; restore the metadata for later acceptance checks.
 const {createHash}=await import("node:crypto"),{readFile}=await import("node:fs/promises");
 const hash=createHash("sha256").update(await readFile("migrations/postgres/001_initial.sql")).digest("hex");await db.pool!.query("UPDATE postgres_migrations SET checksum=$1 WHERE version=1",[hash]);
});
