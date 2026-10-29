import { afterEach,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
const mocks=vi.hoisted(()=>({create:vi.fn(),keys:[] as string[]}));
vi.mock("openai",()=>({default:class {chat={completions:{create:mocks.create}};constructor(options:{apiKey:string}){mocks.keys.push(options.apiKey);}}}));
import { db } from "../src/server/db";
import { createWorkspace } from "../src/server/workspace-repository";
import { joinMember,enqueueChannelAgent,channelSnapshot } from "../src/server/collaboration-repository";
import { updateAIConfig } from "../src/server/ai-workspace";
import { updateAISettings,getAISettings } from "../src/server/ai-repository";
import { ensureWorker } from "../src/server/queue";
import { runAgent } from "../src/server/agent-worker";
const io={to:()=>({emit:()=>{}})} as unknown as Server;
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();mocks.create.mockReset();mocks.keys.length=0;});
function fixture(){const actor=randomUUID();db.prepare('INSERT INTO "user"(id,name,created_at) VALUES (?,?,?)').run(actor,"User",Date.now());const w=createWorkspace(actor,{name:"Worker test"});joinMember(actor,w.id,w.channelId);updateAIConfig(actor,w.id,{enabledProviders:["gemini","groq"],approvedModels:["gemini:gemini-2.5-flash"],defaultModel:null,museModel:null,allowPaid:true,userHourlyLimit:30,workspaceDailyLimit:300});return {actor,...w};}
function state(id:string){return db.prepare("SELECT status,error FROM agent_jobs WHERE id=?").get(id) as {status:string;error:string|null};}
it("runs FIFO jobs through mocked OpenAI and persists real usage fields and mode",async()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-mocked-provider-never-sent");const a=fixture(),first=enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"first",idempotencyKey:randomUUID()}).result.job,second=enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"second",idempotencyKey:randomUUID()}).result.job;
 let active=0,maxActive=0;
 mocks.create.mockImplementation(async()=> (async function*(){active++;maxActive=Math.max(maxActive,active);try{await new Promise(resolve=>setTimeout(resolve,10));yield {choices:[{delta:{content:"Mocked reply"}}],usage:null};yield {choices:[],usage:{prompt_tokens:10,completion_tokens:5}};}finally{active--;}})());
 ensureWorker(io,a.channelId,runAgent);await vi.waitFor(()=>expect(state(second.id).status).toBe("completed"));expect(state(first.id).status).toBe("completed");expect(maxActive).toBe(1);expect(mocks.create.mock.calls[0][0]).toMatchObject({model:"gpt-4o-mini",max_completion_tokens:1024,stream_options:{include_usage:true}});
 const messages=channelSnapshot(a.actor,a.id,a.channelId).messages as {kind:string;mode:string;jobId:string}[];expect(messages.filter(m=>m.kind==="agent").map(m=>m.jobId)).toEqual([first.id,second.id]);expect(messages.filter(m=>m.kind==="agent").every(m=>m.mode==="environment")).toBe(true);expect(getAISettings(a.actor,a.id).usage.tokens).toBe(30);
});
it("fails a quota-exhausted job before calling OpenAI with a clear public error",async()=>{
 vi.stubEnv("OPENAI_API_KEY","sk-mocked-provider-never-sent");vi.spyOn(console,"error").mockImplementation(()=>{});const a=fixture();updateAISettings(a.actor,a.id,{approvedModels:["gpt-4o-mini"],pricing:{"gpt-4o-mini":{input:0.15,output:0.6}},monthlyTokenLimit:0,monthlySpendUsd:0});const j=enqueueChannelAgent(a.actor,a.id,a.channelId,{prompt:"blocked",idempotencyKey:randomUUID()}).result.job;
 ensureWorker(io,a.channelId,runAgent);await vi.waitFor(()=>expect(state(j.id).status).toBe("failed"));expect(state(j.id).error).toContain("monthly usage or spending limit");expect(mocks.create).not.toHaveBeenCalled();expect(getAISettings(a.actor,a.id).records).toEqual([]);
});
