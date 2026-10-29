"use client";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { knownModelPrices } from "@/lib/ai-models";
import type { getAISettings } from "@/server/ai-repository";
export default function AISettingsForm({workspace,settings}:{workspace:string;settings:ReturnType<typeof getAISettings>}){
 const ready=useHydrated(),[models,setModels]=useState(settings.approvedModels.join("\n")),[pricing,setPricing]=useState(settings.pricing),[tokens,setTokens]=useState(settings.monthlyTokenLimit),[spend,setSpend]=useState(settings.monthlySpendUsd),[credential,setCredential]=useState(""),[remove,setRemove]=useState(false),[error,setError]=useState("");
 const names=[...new Set(models.split(/\r?\n/).map(m=>m.trim()).filter(Boolean))];
 async function save(event:React.FormEvent){
  event.preventDefault();const prices=Object.fromEntries(names.map(m=>[m,pricing[m]??(Object.hasOwn(knownModelPrices,m)?knownModelPrices[m]:{input:0,output:0})]));
  const r=await fetch("/api/workspaces/"+workspace+"/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({approvedModels:names,pricing:prices,monthlyTokenLimit:tokens,monthlySpendUsd:spend,...(remove?{credential:null}:credential?{credential}:{})})});
  setCredential("");if(r.ok)window.location.reload();else setError((await r.json()).error);
 }
 return <section inert={!ready} className="settings-section"><h2 className="text-lg">Owner OpenAI settings (paid, optional)</h2><p className="text-xs leading-6 text-muted">Active mode: {settings.mode}. {settings.hasCredential?"Saved workspace credential ending in "+settings.credentialLast4:"No workspace credential saved."}</p>
 <form onSubmit={event=>void save(event)} className="space-y-4"><label className="block">Approved OpenAI models (one per line)<textarea aria-label="Approved models" className="block w-full bg-panel border border-line p-2" rows={3} value={models} onChange={e=>setModels(e.target.value)} required/></label>
 <p className="text-xs text-muted">USD per million tokens. Default published prices are supplied for GPT-4o and GPT-4o mini. Set current prices for custom models; limits use these rates.</p>
 {names.map(model=>{const rate=Object.hasOwn(pricing,model)?pricing[model]:Object.hasOwn(knownModelPrices,model)?knownModelPrices[model]:undefined;return <div key={model} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-3"><span>{model}</span>{(["input","output"] as const).map(kind=><label key={kind}>{kind} USD / 1M<input aria-label={model+" "+kind+" price"} className="block w-28 bg-panel border border-line p-2" type="number" min={0} max={1000} step="any" required value={rate?.[kind]??""} onChange={e=>setPricing(current=>({...current,[model]:{...(current[model]??knownModelPrices[model]??{input:0,output:0}),[kind]:Number(e.target.value)}}))}/></label>)}</div>;})}
 <div className="flex flex-wrap gap-4"><label>Monthly token limit<input aria-label="Monthly token limit" className="block bg-panel border border-line p-2" type="number" min={0} max={1000000000} value={tokens} onChange={e=>setTokens(Number(e.target.value))}/></label><label>Monthly spending limit (USD)<input aria-label="Monthly spending limit" className="block bg-panel border border-line p-2" type="number" min={0} max={100000} step="0.01" value={spend} onChange={e=>setSpend(Number(e.target.value))}/></label></div>
 <label className="block">Workspace OpenAI credential<input aria-label="Workspace OpenAI credential" type="password" autoComplete="off" disabled={remove} className="block w-full bg-panel border border-line p-2" value={credential} onChange={e=>setCredential(e.target.value)} placeholder="Leave blank to keep the saved credential" maxLength={512}/></label>
 {settings.hasCredential&&<label className="block"><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/> Remove saved workspace credential</label>}
 <button className="btn-primary">Save AI settings</button>{error&&<p role="alert" className="text-xs text-danger">{error}</p>}</form>
 <p className="text-xs leading-6 text-muted">Current month (UTC): {settings.usage.tokens.toLocaleString()} used or reserved tokens; ${(settings.usage.spendMicros/1000000).toFixed(6)} recorded or reserved spend.</p>
 <div className="overflow-x-auto rounded-md border border-line"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr><th>Model / mode</th><th>Input / output</th><th>Reserved</th><th>Status / time</th></tr></thead><tbody>{(settings.records as {jobId:string|null;model:string;mode:string;inputTokens:number;outputTokens:number;reservedTokens:number;status:string;createdAt:number}[]).map((r,i)=><tr key={r.jobId??i}><td>{r.model} / {r.mode}</td><td>{r.inputTokens} / {r.outputTokens}</td><td>{r.reservedTokens}</td><td>{r.status} / {new Date(r.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>
 </section>;
}
