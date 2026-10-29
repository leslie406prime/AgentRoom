import { expect,test,type Page } from "@playwright/test";
import Database from "better-sqlite3";
const origin="http://localhost:3000";
async function login(page:Page,name:string){await page.goto("/sign-in");await page.getByLabel("Mock identity").fill(name);await page.getByRole("button",{name:"Continue with Google"}).click();await expect(page).toHaveURL(origin+"/",{timeout:60000});}
test("invitation redirects survive sign-in and expired/revoked/exhausted links fail generically with atomic use limits",async({browser})=>{
 const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);const [owner,member,other]=await Promise.all(contexts.map(c=>c.newPage()));const run=Date.now().toString(36);
 try{
  await login(owner,"invite-owner-"+run);
  const created=await owner.request.post("/api/workspaces",{headers:{origin},data:{name:"Private invitation name"}});expect(created.status()).toBe(201);const workspace=await created.json();
  async function invite(ws=workspace.id){const r=await owner.request.post("/api/workspaces/"+ws+"/invitations",{headers:{origin},data:{}});expect(r.status()).toBe(201);return await r.json() as {id:string;path:string};}
  const first=await invite();await member.goto(first.path);await expect(member.getByRole("button",{name:"Continue with Google",exact:true})).toBeVisible();await member.getByLabel("Mock identity").fill("invite-member-"+run);await member.getByRole("button",{name:"Continue with Google"}).click();await expect(member.getByRole("heading",{name:"Workspace invitation",exact:true})).toBeVisible();await member.getByRole("button",{name:"Accept invitation",exact:true}).click();await expect(member.getByText("Connected",{exact:true})).toBeVisible({timeout:30000});
  await login(other,"invite-other-"+run);
  async function rejected(link:string){expect((await other.request.post("/api/invitations/"+link.split("/").at(-1),{headers:{origin}})).status()).toBe(404);await other.goto(link);await expect(other.getByRole("heading",{name:"This invitation is unavailable"})).toBeVisible();await expect(other.getByText("Private invitation name")).toHaveCount(0);}
  await rejected(first.path);
  const expired=await invite();const db=new Database("./data/agentroom-e2e.sqlite");db.pragma("busy_timeout=5000");db.prepare("UPDATE invitations SET expires_at=0 WHERE workspace_id=? AND id=?").run(workspace.id,expired.id);db.close();await rejected(expired.path);
  const revoked=await invite();expect((await owner.request.delete("/api/workspaces/"+workspace.id+"/invitations",{headers:{origin},data:{id:revoked.id}})).status()).toBe(200);await rejected(revoked.path);
  const race=await (await owner.request.post("/api/workspaces",{headers:{origin},data:{name:"Race workspace"}})).json();const racing=await invite(race.id),token=racing.path.split("/").at(-1);
  const results=await Promise.all([member,other].map(p=>p.request.post("/api/invitations/"+token,{headers:{origin}})));expect(results.map(r=>r.status()).sort()).toEqual([200,404]);
  const winner=results[0].status()===200?member:other;expect((await winner.request.post("/api/invitations/"+token,{headers:{origin}})).status()).toBe(200);
  const list=await (await owner.request.get("/api/workspaces/"+race.id+"/invitations")).json();expect(list.find((i:{id:string})=>i.id===racing.id).uses).toBe(1);const state=await (await owner.request.get("/api/workspaces/"+race.id)).json();expect(state.members).toHaveLength(2);
 }finally{for(const context of contexts)await context.close();}
});
