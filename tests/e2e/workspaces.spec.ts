import { expect,test,type BrowserContext,type Page } from "@playwright/test";
import { io,type Socket } from "socket.io-client";
const origin="http://localhost:3000";
async function login(page:Page,name:string){await page.goto("/sign-in");await page.getByLabel("Mock identity").fill(name);await page.getByRole("button",{name:"Continue with Google"}).click();await expect(page).toHaveURL(origin+"/",{timeout:60000});return (await (await page.request.get("/api/auth/session")).json()).user.id as string;}
async function socket(context:BrowserContext){const cookie=(await context.cookies()).map(c=>c.name+"="+c.value).join("; ");const s=io(origin,{extraHeaders:{Cookie:cookie,Origin:origin},reconnection:false,forceNew:true});await new Promise<void>((resolve,reject)=>{s.once("connect",()=>resolve());s.once("connect_error",reject);});return s;}
test("REST and socket boundaries isolate workspaces and member removal revokes active access",async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();const owner=await a.newPage(),member=await b.newPage(),run=Date.now().toString(36);let live:Socket|undefined,foreign:Socket|undefined;
 try{
  const ownerId=await login(owner,"owner-"+run),memberId=await login(member,"member-"+run);
  const created=await owner.request.post("/api/workspaces",{headers:{origin},data:{name:"Security workspace"}});expect(created.status()).toBe(201);const w=await created.json();
  expect((await member.request.get("/api/workspaces/"+w.id)).status()).toBe(404);
  const snapshotPath="/api/workspaces/"+w.id+"/channels/"+w.channelId;
  expect((await owner.request.get(snapshotPath)).status()).toBe(200);expect((await member.request.get(snapshotPath)).status()).toBe(404);
  foreign=await socket(b);expect(await foreign.timeout(8000).emitWithAck("room:join",{roomId:w.channelId,lastSeq:0})).toHaveProperty("error");expect(await foreign.timeout(8000).emitWithAck("message:send",{clientId:crypto.randomUUID(),content:"forbidden"})).toHaveProperty("error");expect(await foreign.timeout(8000).emitWithAck("agent:request",{idempotencyKey:crypto.randomUUID(),prompt:"forbidden"})).toHaveProperty("error");foreign.close();
  const invite=await owner.request.post("/api/workspaces/"+w.id+"/invitations",{headers:{origin},data:{}});expect(invite.status()).toBe(201);const path=(await invite.json()).path;
  expect((await member.request.post("/api/invitations/"+path.split("/").at(-1),{headers:{origin}})).status()).toBe(200);
  expect((await member.request.post("/api/workspaces/"+w.id+"/channels",{headers:{origin},data:{name:"forbidden"}})).status()).toBe(403);
  expect((await member.request.post("/api/workspaces/"+w.id+"/invitations",{headers:{origin},data:{}})).status()).toBe(403);
  expect((await owner.request.post("/api/workspaces/"+w.id+"/members",{headers:{origin},data:{userId:ownerId}})).status()).toBe(409);
  live=await socket(b);expect(await live.timeout(8000).emitWithAck("room:join",{roomId:w.channelId,lastSeq:0})).toHaveProperty("state");
  const settingsPath="/api/workspaces/"+w.id+"/settings";
  const config={approvedModels:["gpt-4o-mini"],pricing:{"gpt-4o-mini":{input:0.15,output:0.6}},monthlyTokenLimit:1000000,monthlySpendUsd:20};
  expect((await member.request.get(settingsPath)).status()).toBe(403);
  expect((await member.request.put(settingsPath,{headers:{origin},data:config})).status()).toBe(403);
  const agentConfigPath="/api/workspaces/"+w.id+"/ai/config",agentConfig={enabledProviders:["gemini","groq"],approvedModels:["gemini:gemini-2.5-flash"],defaultModel:null,museModel:null,allowPaid:true,userHourlyLimit:30,workspaceDailyLimit:300};
  expect((await member.request.put(agentConfigPath,{headers:{origin},data:agentConfig})).status()).toBe(403);
  const authorized=new Promise(resolve=>live!.once("workspace:ai",resolve));
  expect((await owner.request.put(agentConfigPath,{headers:{origin},data:agentConfig})).status()).toBe(200);await authorized; // a saved OpenAI credential only works once paid usage is explicitly authorized
  const changed=new Promise<{mode:string}>(resolve=>live!.once("workspace:ai",resolve));
  const saved=await owner.request.put(settingsPath,{headers:{origin},data:{...config,credential:"sk-test-only-never-used-4321"}});expect(saved.status()).toBe(200);const savedBody=await saved.json();expect(JSON.stringify(savedBody)).not.toContain("sk-test-only-never-used-4321");expect(savedBody.credentialLast4).toBe("4321");expect((await changed).mode).toBe("workspace");
  expect((await member.request.get("/api/workspaces/"+w.id+"/ai")).status()).toBe(200);
  expect((await owner.request.put(settingsPath,{headers:{origin},data:{...config,credential:null}})).status()).toBe(200);
  const disconnected=new Promise<void>(resolve=>live!.once("disconnect",()=>resolve()));
  expect((await owner.request.post("/api/workspaces/"+w.id+"/members",{headers:{origin},data:{userId:memberId}})).status()).toBe(200);await disconnected;expect(live.connected).toBe(false);expect((await member.request.get(snapshotPath)).status()).toBe(404);
 }finally{live?.close();foreign?.close();await a.close();await b.close();}
});
