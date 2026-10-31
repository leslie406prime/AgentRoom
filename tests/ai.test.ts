import { afterEach,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { createWorkspace,createInvitation,acceptInvitation } from "../src/server/workspace-repository";
import { createChannel } from "../src/server/channel-repository";
import { joinMember,enqueueChannelAgent,deleteChannelMessage,sendChannelMessage,channelSnapshot } from "../src/server/collaboration-repository";
import { getAISettings,updateAISettings,publicAIConfig,jobAI,reserveUsage,completeUsage,failUsage } from "../src/server/ai-repository";
import { updateAIConfig } from "../src/server/ai-workspace";
import { encryptCredential,decryptCredential } from "../src/server/credential-encryption";
afterEach(()=>vi.unstubAllEnvs());
async function user(){const id=randomUUID();(await db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(id,"User",Date.now()));return id;}
async function fixture(){const actor=(await user()),other=(await user()),w=(await createWorkspace(actor,{name:"AI tests"}));(await joinMember(actor,w.id,w.channelId));return {actor,other,...w};}
async function paid(a:{actor:string;id:string}){(await updateAIConfig(a.actor,a.id,{enabledProviders:["gemini","groq"],approvedModels:["gemini:gemini-2.5-flash"],defaultModel:null,museModel:null,allowPaid:true,userHourlyLimit:30,workspaceDailyLimit:300}));}
function settings(){return {approvedModels:["gpt-4o-mini"],pricing:{"gpt-4o-mini":{input:0.15,output:0.6}},monthlyTokenLimit:1000000,monthlySpendUsd:20};}
async function job(a:Awaited<ReturnType<typeof fixture>>,channel=a.channelId){return (await enqueueChannelAgent(a.actor,a.id,channel,{prompt:"Test",idempotencyKey:randomUUID()})).result.job;}
it("encrypts credentials with workspace authentication and never returns plaintext",async ()=>{
 vi.stubEnv("WORKSPACE_CREDENTIAL_KEY",Buffer.alloc(32,7).toString("base64"));const a=(await fixture()),secret="sk-test-workspace-secret-4321";
 const first=encryptCredential(a.id,secret),second=encryptCredential(a.id,secret);expect(first).not.toBe(second);expect(first).not.toContain(secret);expect(decryptCredential(a.id,first)).toBe(secret);expect(()=>decryptCredential(a.id+"x",first)).toThrow();
 const result=(await updateAISettings(a.actor,a.id,{...settings(),credential:secret}));expect(result.credentialLast4).toBe("4321");expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify((await publicAIConfig(a.actor,a.id)))).not.toContain("4321");
 const row=(await db.prepare("SELECT credential_ciphertext FROM ai_provider_settings WHERE workspace_id=?").get(a.id)) as {credential_ciphertext:string};expect(row.credential_ciphertext).not.toContain(secret);
});
it("restricts AI settings to owners, including credential writes",async ()=>{
 const a=(await fixture()),invite=(await createInvitation(a.actor,a.id,{role:"ADMIN"}));(await acceptInvitation(a.other,invite.path.split("/").at(-1)!));
 (await expect((async () => (await getAISettings(a.other,a.id)))()).rejects.toThrow("not allowed"));(await expect((async () => (await updateAISettings(a.other,a.id,settings())))()).rejects.toThrow("not allowed"));expect((await publicAIConfig(a.other,a.id)).models).toEqual([]);expect(JSON.stringify((await publicAIConfig(a.other,a.id)))).not.toMatch(/sk-|ciphertext/);
});
it("selects workspace key, environment key, then demo mode",async ()=>{
 vi.stubEnv("WORKSPACE_CREDENTIAL_KEY",Buffer.alloc(32,9).toString("base64"));vi.stubEnv("OPENAI_API_KEY","");const a=(await fixture()),j=(await job(a));expect((await jobAI(j)).mode).toBe("demo");(await paid(a));
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");expect((await jobAI(j)).mode).toBe("environment");
 (await updateAISettings(a.actor,a.id,{...settings(),credential:"sk-workspace-test-secret"}));expect((await jobAI(j)).mode).toBe("workspace");expect((await jobAI(j)).key).toBe("sk-workspace-test-secret");
 (await updateAISettings(a.actor,a.id,{...settings(),credential:null}));expect((await jobAI(j)).mode).toBe("environment");
});
it("enforces approved models both when queuing and before execution",async ()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");const a=(await fixture());(await expect((async () => (await enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"Test",idempotencyKey:randomUUID(),model:"gpt-4o-mini"})))()).rejects.toThrow("authorized"));(await paid(a));(await expect((async () => (await enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"Test",idempotencyKey:randomUUID(),model:"not-approved"})))()).rejects.toThrow("approved"));const j=(await enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"Test",idempotencyKey:randomUUID(),model:"gpt-4o-mini"})).result.job;
 (await updateAISettings(a.actor,a.id,{...settings(),approvedModels:["gpt-4o"],pricing:{"gpt-4o":{input:2.5,output:10}}}));(await expect((async () => (await jobAI(j)))()).rejects.toThrow("no longer approved"));
});
it("reserves workspace quota across channels and replaces reservations with actual usage",async ()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");const a=(await fixture()),second=(await createChannel(a.actor,a.id,{name:"second"}));(await paid(a));(await joinMember(a.actor,a.id,second.id));(await updateAISettings(a.actor,a.id,{...settings(),monthlyTokenLimit:2500}));const first=(await job(a)),next=(await job(a,second.id));
 (await reserveUsage(first,(await jobAI(first)),1000));(await expect((async () => (await reserveUsage(next,(await jobAI(next)),1000)))()).rejects.toThrow("insufficient remaining quota"));(await completeUsage(a.id,first.id,{prompt_tokens:10,completion_tokens:20}));(await reserveUsage(next,(await jobAI(next)),1000));expect((await getAISettings(a.actor,a.id)).usage.tokens).toBe(2054);
});
it("enforces spending limits and retains conservative usage after interruptions",async ()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");const a=(await fixture());(await paid(a));const j=(await job(a));(await updateAISettings(a.actor,a.id,{...settings(),monthlySpendUsd:0}));(await expect((async () => (await reserveUsage(j,(await jobAI(j)),1000)))()).rejects.toThrow("insufficient remaining quota"));
 (await updateAISettings(a.actor,a.id,settings()));(await reserveUsage(j,(await jobAI(j)),1000));(await completeUsage(a.id,j.id));expect((await getAISettings(a.actor,a.id)).usage.tokens).toBe(2024);(await expect((async () => (await reserveUsage(j,(await jobAI(j)),1000)))()).rejects.toThrow("interrupted"));(await failUsage(j.id));
});
it("allows zero-cost demo jobs with zero token/spending limits",async ()=>{
 vi.stubEnv("OPENAI_API_KEY","");const a=(await fixture()),j=(await job(a));(await updateAISettings(a.actor,a.id,{...settings(),monthlyTokenLimit:0,monthlySpendUsd:0}));(await reserveUsage(j,(await jobAI(j)),1000));(await completeUsage(a.id,j.id,{prompt_tokens:0,completion_tokens:0}));expect((await getAISettings(a.actor,a.id)).usage).toEqual({tokens:0,spendMicros:0});
});
it("moderates messages without leaking deleted text through replay",async ()=>{
 const a=(await fixture()),invite=(await createInvitation(a.actor,a.id,{}));(await acceptInvitation(a.other,invite.path.split("/").at(-1)!));(await joinMember(a.other,a.id,a.channelId));const id=randomUUID();(await sendChannelMessage(a.actor,a.id,a.channelId,{clientId:id,content:"Remove this text"}));(await expect((async () => (await deleteChannelMessage(a.other,a.id,a.channelId,id)))()).rejects.toThrow());(await deleteChannelMessage(a.actor,a.id,a.channelId,id));const snapshot=(await channelSnapshot(a.actor,a.id,a.channelId));expect(snapshot.messages).toEqual([]);expect(JSON.stringify(snapshot.replay)).not.toContain("Remove this text");
});
