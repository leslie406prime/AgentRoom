import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { requireRole,audit } from "./workspace-repository";
import { encryptCredential,decryptCredential } from "./credential-encryption";
import { HttpError } from "./http-security";
import { PublicJobError } from "./job-errors";
import { knownModelPrices } from "../lib/ai-models";
import type { AgentJob } from "./collaboration-types";
import { agentTarget,defaultAgent,loadConfig,publicAIConfig,enforceRequestLimits } from "./ai-workspace";
import { providerKey } from "./ai-providers";
import { agentInfo,parseModelKey,type AgentId,type ProviderId } from "../lib/ai-catalog";
export { publicAIConfig };
const ModelId=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/);
const Price=z.object({input:z.number().finite().min(0).max(1000),output:z.number().finite().min(0).max(1000)}).strict();
export const AISettingsInput=z.object({approvedModels:z.array(ModelId).min(1).max(20),pricing:z.record(ModelId,Price),monthlyTokenLimit:z.number().int().min(0).max(1000000000),monthlySpendUsd:z.number().finite().min(0).max(100000),credential:z.string().min(16).max(512).nullable().optional()}).strict().superRefine((value,ctx)=>{if(new Set(value.approvedModels).size!==value.approvedModels.length||Object.keys(value.pricing).length>20||value.approvedModels.some(m=>!Object.hasOwn(value.pricing,m)))ctx.addIssue({code:"custom",message:"Provide unique models and prices for every approved model."});});
type SettingsRow={approved_models:string;pricing:string;credential_ciphertext:string|null;credential_last4:string|null;monthly_token_limit:number;monthly_spend_micros:number};
function settingsRow(workspace:string):SettingsRow{
 const row=db.prepare("SELECT approved_models,pricing,credential_ciphertext,credential_last4,monthly_token_limit,monthly_spend_micros FROM ai_provider_settings WHERE workspace_id=?").get(workspace) as SettingsRow|undefined;
 const model=process.env.OPENAI_MODEL??"gpt-4o-mini";
 return row??{approved_models:JSON.stringify([model]),pricing:JSON.stringify(Object.hasOwn(knownModelPrices,model)?{[model]:knownModelPrices[model]}:{}),credential_ciphertext:null,credential_last4:null,monthly_token_limit:1000000,monthly_spend_micros:20000000};
}
function models(row:SettingsRow){return z.array(ModelId).min(1).max(20).parse(JSON.parse(row.approved_models));}
function mode(row:SettingsRow){return row.credential_ciphertext?"workspace":process.env.OPENAI_API_KEY?"environment":"demo";}
export function openaiAccess(workspace:string){const row=settingsRow(workspace);return {approved:models(row),source:(row.credential_ciphertext?"workspace":process.env.OPENAI_API_KEY?"environment":null) as "workspace"|"environment"|null};}
function monthStart(now=Date.now()){const date=new Date(now);return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);}
function usageSummary(workspace:string){return db.prepare("SELECT COALESCE(SUM(input_tokens+output_tokens+reserved_tokens),0) AS tokens,COALESCE(SUM(cost_micros+reserved_cost_micros),0) AS spendMicros FROM usage_records WHERE workspace_id=? AND created_at>=?").get(workspace,monthStart()) as {tokens:number;spendMicros:number};}
export function getAISettings(actor:string,workspace:string){
 requireRole(actor,workspace,"settings");const row=settingsRow(workspace);
 const records=db.prepare("SELECT job_id AS jobId,provider,agent,model,mode,input_tokens AS inputTokens,output_tokens AS outputTokens,reserved_tokens AS reservedTokens,cost_micros AS costMicros,reserved_cost_micros AS reservedCostMicros,status,created_at AS createdAt FROM usage_records WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").all(workspace);
 return {approvedModels:models(row),pricing:z.record(ModelId,Price).parse(JSON.parse(row.pricing)),monthlyTokenLimit:row.monthly_token_limit,monthlySpendUsd:row.monthly_spend_micros/1000000,hasCredential:Boolean(row.credential_ciphertext),credentialLast4:row.credential_last4,mode:mode(row),usage:usageSummary(workspace),records};
}
export function updateAISettings(actor:string,workspace:string,input:unknown){
 const parsed=AISettingsInput.parse(input);
 db.transaction(()=>{
  requireRole(actor,workspace,"settings");const current=settingsRow(workspace);
  const encrypted=parsed.credential===undefined?current.credential_ciphertext:parsed.credential===null?null:encryptCredential(workspace,parsed.credential);
  const last4=parsed.credential===undefined?current.credential_last4:parsed.credential===null?null:parsed.credential.slice(-4);
  db.prepare("INSERT INTO ai_provider_settings(workspace_id,approved_models,pricing,credential_ciphertext,credential_last4,monthly_token_limit,monthly_spend_micros) VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET approved_models=excluded.approved_models,pricing=excluded.pricing,credential_ciphertext=excluded.credential_ciphertext,credential_last4=excluded.credential_last4,monthly_token_limit=excluded.monthly_token_limit,monthly_spend_micros=excluded.monthly_spend_micros").run(workspace,JSON.stringify(parsed.approvedModels),JSON.stringify(parsed.pricing),encrypted,last4,parsed.monthlyTokenLimit,Math.round(parsed.monthlySpendUsd*1000000));
  audit(workspace,actor,parsed.credential===undefined?"ai:settings":"credential:change");
 }).immediate();
 return getAISettings(actor,workspace);
}
// Pre-upgrade jobs and clients used bare OpenAI model IDs.
const normalizeModelKey=(value:string)=>/^(gemini|groq|openai):/.test(value)?value:"openai:"+value;
export type RequestedAgent={agent?:AgentId;model?:string};
// Resolves who answers and with which model. Throws a 4xx the requester sees; never falls back to a paid model.
export function selectAgentTarget(actor:string,workspace:string,requested:RequestedAgent){
 requireRole(actor,workspace,"agent");const cfg=loadConfig(workspace);
 const agent=requested.agent??defaultAgent(workspace,cfg),model=requested.model?normalizeModelKey(requested.model):undefined;
 const target=agentTarget(workspace,cfg,agent,model);
 if(!target.ok)throw new HttpError(400,target.reason,target.code);
 return {agent,model:target.modelKey,provider:target.modelKey?parseModelKey(target.modelKey)!.provider:null,credential:target.credential};
}
export {enforceRequestLimits};
// Server worker only: this value includes a decrypted key and must never be serialized.
export function jobAI(job:AgentJob){
 const channel=db.prepare("SELECT c.workspace_id AS workspaceId,w.unclaimed_legacy AS unclaimed,c.archived FROM channels c JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=? AND c.visibility='public'").get(job.room_id) as {workspaceId:string;unclaimed:number;archived:number}|undefined;
 if(!channel||channel.unclaimed||channel.archived)throw new PublicJobError("This channel is unavailable.",false,"CHANNEL_UNAVAILABLE");
 const member=db.prepare("SELECT user_id FROM members WHERE room_id=? AND id=?").get(job.room_id,job.requester_id) as {user_id:string|null}|undefined;
 if(!member)throw new PublicJobError("The requester no longer has access to this channel.",false,"ACCESS_DENIED");
 if(member.user_id){try{requireRole(member.user_id,channel.workspaceId,"agent");}catch{throw new PublicJobError("The requester no longer has access to this channel.",false,"ACCESS_DENIED");}}
 const workspaceId=channel.workspaceId,cfg=loadConfig(workspaceId),agent=(job.agent??"agent") as AgentId;
 const stored=job.model?normalizeModelKey(job.model):null;
 // Muse always follows the owner's current choice; other agents must still be allowed to run the model they were queued with.
 const target=agentTarget(workspaceId,cfg,agent,agent==="muse"?null:stored);
 if(!target.ok)throw new PublicJobError(target.reason.startsWith("Not approved")?"This job's model is no longer approved. Choose an approved model and submit again.":`This job can't run: ${target.reason}`,false,target.code);
 const base={workspaceId,agent,agentLabel:agentInfo[agent].label,maxOutputTokens:agent==="muse"?2048:maxOutputTokens};
 if(!target.modelKey)return {...base,provider:null as ProviderId|null,model:"demo",modelKey:null as string|null,key:null as string|null,mode:"demo" as const,price:{input:0,output:0}};
 const parsed=parseModelKey(target.modelKey)!;
 if(parsed.provider!=="openai"){
  const key=providerKey(parsed.provider);if(!key)throw new PublicJobError("This provider is not configured on the server.",false,"MISSING_ENVIRONMENT");
  return {...base,provider:parsed.provider as ProviderId|null,model:parsed.id,modelKey:target.modelKey as string|null,key:key as string|null,mode:"environment" as const,price:{input:0,output:0}};
 }
 const row=settingsRow(workspaceId);
 let key=process.env.OPENAI_API_KEY??null;
 if(row.credential_ciphertext){try{key=decryptCredential(workspaceId,row.credential_ciphertext);}catch{throw new PublicJobError("The workspace credential could not be decrypted. Ask an owner to save it again.",false,"CREDENTIAL_DECRYPTION_FAILED");}}
 const prices=z.record(ModelId,Price).parse(JSON.parse(row.pricing)),price=Object.hasOwn(prices,parsed.id)?prices[parsed.id]:undefined;
 if(key&&!price)throw new PublicJobError("An owner must configure token prices for this model before it can run.");
 return {...base,provider:"openai" as ProviderId|null,model:parsed.id,modelKey:target.modelKey as string|null,key,mode:mode(row),price:price??{input:0,output:0}};
}
export const maxOutputTokens=1024;
export function reserveUsage(job:AgentJob,config:ReturnType<typeof jobAI>,inputBound:number){
 return db.transaction(()=>{
  const row=settingsRow(config.workspaceId),totals=usageSummary(config.workspaceId);
  if(db.prepare("SELECT 1 FROM usage_records WHERE workspace_id=? AND job_id=?").get(config.workspaceId,job.id))throw new PublicJobError("This interrupted job already reserved usage. Submit a new request.",false,"USAGE_RESERVATION_EXISTS");
  const out=config.maxOutputTokens??maxOutputTokens,tokens=config.mode==="demo"?0:inputBound+out,cost=config.mode==="demo"?0:Math.ceil(inputBound*config.price.input+out*config.price.output);
  if(totals.tokens+tokens>row.monthly_token_limit||totals.spendMicros+cost>row.monthly_spend_micros)throw new PublicJobError("The workspace monthly usage or spending limit has insufficient remaining quota for this job.",false,"WORKSPACE_QUOTA");
  db.prepare("INSERT INTO usage_records(id,workspace_id,channel_id,job_id,model,mode,reserved_tokens,reserved_cost_micros,input_rate,output_rate,status,created_at,provider,agent) VALUES (?,?,?,?,?,?,?,?,?,?,'reserved',?,?,?)").run(randomUUID(),config.workspaceId,job.room_id,job.id,config.model,config.mode,tokens,cost,config.price.input,config.price.output,Date.now(),config.provider,config.agent);
 }).immediate();
}
export function completeUsage(workspace:string,jobId:string,usage?:{prompt_tokens:number;completion_tokens:number}){
 const record=db.prepare("SELECT input_rate,output_rate FROM usage_records WHERE workspace_id=? AND job_id=?").get(workspace,jobId) as {input_rate:number;output_rate:number}|undefined;
 if(!record)return;
 if(!usage){db.prepare("UPDATE usage_records SET status='estimated' WHERE workspace_id=? AND job_id=?").run(workspace,jobId);return;}
 const counts=z.object({prompt_tokens:z.number().int().min(0).max(1000000000),completion_tokens:z.number().int().min(0).max(1000000000)}).parse(usage);
 db.prepare("UPDATE usage_records SET input_tokens=?,output_tokens=?,cost_micros=?,reserved_tokens=0,reserved_cost_micros=0,status='completed' WHERE workspace_id=? AND job_id=?").run(counts.prompt_tokens,counts.completion_tokens,Math.ceil(counts.prompt_tokens*record.input_rate+counts.completion_tokens*record.output_rate),workspace,jobId);
}
// release=true: the provider rejected the call before consuming tokens, so the reservation is returned to the quota.
export function failUsage(jobId:string,release=false){if(release)db.prepare("UPDATE usage_records SET status='failed',reserved_tokens=0,reserved_cost_micros=0 WHERE job_id=? AND status='reserved'").run(jobId);else db.prepare("UPDATE usage_records SET status='failed-estimated' WHERE job_id=? AND status='reserved'").run(jobId);}
