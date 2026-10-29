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
function user(){const id=randomUUID();db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(id,"User",Date.now());return id;}
function fixture(){const actor=user(),other=user(),w=createWorkspace(actor,{name:"AI tests"});joinMember(actor,w.id,w.channelId);return {actor,other,...w};}
function paid(a:{actor:string;id:string}){updateAIConfig(a.actor,a.id,{enabledProviders:["gemini","groq"],approvedModels:["gemini:gemini-2.5-flash"],defaultModel:null,museModel:null,allowPaid:true,userHourlyLimit:30,workspaceDailyLimit:300});}
function settings(){return {approvedModels:["gpt-4o-mini"],pricing:{"gpt-4o-mini":{input:0.15,output:0.6}},monthlyTokenLimit:1000000,monthlySpendUsd:20};}
function job(a:ReturnType<typeof fixture>,channel=a.channelId){return enqueueChannelAgent(a.actor,a.id,channel,{prompt:"Test",idempotencyKey:randomUUID()}).result.job;}
it("encrypts credentials with workspace authentication and never returns plaintext",()=>{
 vi.stubEnv("WORKSPACE_CREDENTIAL_KEY",Buffer.alloc(32,7).toString("base64"));const a=fixture(),secret="sk-test-workspace-secret-4321";
 const first=encryptCredential(a.id,secret),second=encryptCredential(a.id,secret);expect(first).not.toBe(second);expect(first).not.toContain(secret);expect(decryptCredential(a.id,first)).toBe(secret);expect(()=>decryptCredential(a.id+"x",first)).toThrow();
 const result=updateAISettings(a.actor,a.id,{...settings(),credential:secret});expect(result.credentialLast4).toBe("4321");expect(JSON.stringify(result)).not.toContain(secret);expect(JSON.stringify(publicAIConfig(a.actor,a.id))).not.toContain("4321");
 const row=db.prepare("SELECT credential_ciphertext FROM ai_provider_settings WHERE workspace_id=?").get(a.id) as {credential_ciphertext:string};expect(row.credential_ciphertext).not.toContain(secret);
});
it("restricts AI settings to owners, including credential writes",()=>{
 const a=fixture(),invite=createInvitation(a.actor,a.id,{role:"ADMIN"});acceptInvitation(a.other,invite.path.split("/").at(-1)!);
 expect(()=>getAISettings(a.other,a.id)).toThrow("not allowed");expect(()=>updateAISettings(a.other,a.id,settings())).toThrow("not allowed");expect(publicAIConfig(a.other,a.id).models).toEqual([]);expect(JSON.stringify(publicAIConfig(a.other,a.id))).not.toMatch(/sk-|ciphertext/);
});
it("selects workspace key, environment key, then demo mode",()=>{
 vi.stubEnv("WORKSPACE_CREDENTIAL_KEY",Buffer.alloc(32,9).toString("base64"));vi.stubEnv("OPENAI_API_KEY","");const a=fixture(),j=job(a);expect(jobAI(j).mode).toBe("demo");paid(a);
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");expect(jobAI(j).mode).toBe("environment");
 updateAISettings(a.actor,a.id,{...settings(),credential:"sk-workspace-test-secret"});expect(jobAI(j).mode).toBe("workspace");expect(jobAI(j).key).toBe("sk-workspace-test-secret");
 updateAISettings(a.actor,a.id,{...settings(),credential:null});expect(jobAI(j).mode).toBe("environment");
});
it("enforces approved models both when queuing and before execution",()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");const a=fixture();expect(()=>enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"Test",idempotencyKey:randomUUID(),model:"gpt-4o-mini"})).toThrow("authorized");paid(a);expect(()=>enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"Test",idempotencyKey:randomUUID(),model:"not-approved"})).toThrow("approved");const j=enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"Test",idempotencyKey:randomUUID(),model:"gpt-4o-mini"}).result.job;
 updateAISettings(a.actor,a.id,{...settings(),approvedModels:["gpt-4o"],pricing:{"gpt-4o":{input:2.5,output:10}}});expect(()=>jobAI(j)).toThrow("no longer approved");
});
it("reserves workspace quota across channels and replaces reservations with actual usage",()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");const a=fixture(),second=createChannel(a.actor,a.id,{name:"second"});paid(a);joinMember(a.actor,a.id,second.id);updateAISettings(a.actor,a.id,{...settings(),monthlyTokenLimit:2500});const first=job(a),next=job(a,second.id);
 reserveUsage(first,jobAI(first),1000);expect(()=>reserveUsage(next,jobAI(next),1000)).toThrow("insufficient remaining quota");completeUsage(a.id,first.id,{prompt_tokens:10,completion_tokens:20});reserveUsage(next,jobAI(next),1000);expect(getAISettings(a.actor,a.id).usage.tokens).toBe(2054);
});
it("enforces spending limits and retains conservative usage after interruptions",()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-environment-test-secret");const a=fixture();paid(a);const j=job(a);updateAISettings(a.actor,a.id,{...settings(),monthlySpendUsd:0});expect(()=>reserveUsage(j,jobAI(j),1000)).toThrow("insufficient remaining quota");
 updateAISettings(a.actor,a.id,settings());reserveUsage(j,jobAI(j),1000);completeUsage(a.id,j.id);expect(getAISettings(a.actor,a.id).usage.tokens).toBe(2024);expect(()=>reserveUsage(j,jobAI(j),1000)).toThrow("interrupted");failUsage(j.id);
});
it("allows zero-cost demo jobs with zero token/spending limits",()=>{
 vi.stubEnv("OPENAI_API_KEY","");const a=fixture(),j=job(a);updateAISettings(a.actor,a.id,{...settings(),monthlyTokenLimit:0,monthlySpendUsd:0});reserveUsage(j,jobAI(j),1000);completeUsage(a.id,j.id,{prompt_tokens:0,completion_tokens:0});expect(getAISettings(a.actor,a.id).usage).toEqual({tokens:0,spendMicros:0});
});
it("moderates messages without leaking deleted text through replay",()=>{
 const a=fixture(),invite=createInvitation(a.actor,a.id,{});acceptInvitation(a.other,invite.path.split("/").at(-1)!);joinMember(a.other,a.id,a.channelId);const id=randomUUID();sendChannelMessage(a.actor,a.id,a.channelId,{clientId:id,content:"Remove this text"});expect(()=>deleteChannelMessage(a.other,a.id,a.channelId,id)).toThrow();deleteChannelMessage(a.actor,a.id,a.channelId,id);const snapshot=channelSnapshot(a.actor,a.id,a.channelId);expect(snapshot.messages).toEqual([]);expect(JSON.stringify(snapshot.replay)).not.toContain("Remove this text");
});
