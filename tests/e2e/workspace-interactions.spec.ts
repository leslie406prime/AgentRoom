import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.AGENTROOM_MOCK_AI !== "true", "Requires the isolated HTTP-provider mock preload (--mock-ai).");
const origin = "http://localhost:3000";
async function login(page: Page, identity: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Mock identity").fill(identity);
  await page.getByRole("button",{name:"Continue with Google"}).click();
  await expect(page).toHaveURL(origin+"/");
}

test("sidebar channels and agents use the shared authenticated queue and persist", async ({browser}) => {
  test.setTimeout(420000);
  const owner=await browser.newContext(), member=await browser.newContext();
  try {
    const a=await owner.newPage(), b=await member.newPage(), run=Date.now().toString(36);
    await login(a,"sidebar-owner-"+run); await login(b,"sidebar-member-"+run);
    const created=await a.request.post("/api/workspaces",{headers:{origin},data:{name:"Sidebar checks"}});
    expect(created.status()).toBe(201); const w=await created.json();
    const general=`/workspaces/${w.id}/channels/${w.channelId}`;
    const invite=await a.request.post(`/api/workspaces/${w.id}/invitations`,{headers:{origin},data:{}});
    await b.goto((await invite.json()).path); await b.getByRole("button",{name:"Accept invitation",exact:true}).click();
    await a.goto(general); await expect(a.getByText("Connected",{exact:true})).toBeVisible();
    await expect(a.getByRole("navigation",{name:"AI agents",exact:true})).toHaveCount(1);
    await expect(a.getByRole("button",{name:"Select Llama",exact:true})).toBeDisabled();
    await expect(a.getByRole("navigation",{name:"AI agents",exact:true})).toContainText("No Llama model is approved");
    await expect(b.getByRole("button",{name:"Create channel",exact:true})).toHaveCount(0);
    expect((await b.request.post(`/api/workspaces/${w.id}/channels`,{headers:{origin},data:{name:"forbidden"}})).status()).toBe(403);
    await a.getByRole("button",{name:"Create channel",exact:true}).click();
    await a.getByRole("dialog",{name:"Create channel"}).getByLabel("Channel name").fill("Launch Planning");
    await a.getByRole("dialog").getByRole("button",{name:"Create",exact:true}).click();
    await expect(a).toHaveURL(new RegExp(`/workspaces/${w.id}/channels/(?!${w.channelId})`));
    const channelURL=a.url(), channelId=new URL(channelURL).pathname.split("/").at(-1)!;
    await expect(a.getByRole("navigation",{name:"Channels",exact:true}).getByRole("link",{name:"launch-planning"})).toHaveAttribute("aria-current","page");
    await a.reload(); await expect(a.getByRole("navigation",{name:"Channels",exact:true})).toContainText("launch-planning");
    await a.getByRole("button",{name:"Create channel",exact:true}).click();
    await a.getByRole("dialog").getByLabel("Channel name").fill("Launch Planning");
    await a.getByRole("dialog").getByRole("button",{name:"Create",exact:true}).click();
    await expect(a.getByRole("dialog").getByRole("alert")).toContainText("already exists");
    await a.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();
    console.info("ui_channels_permissions_duplicates_and_reload_passed");
    await b.goto(channelURL); await expect(b.getByText("Connected",{exact:true})).toBeVisible();
    const snapshot=async()=>{const r=await a.request.get(`/api/workspaces/${w.id}/channels/${channelId}`,{timeout:15000});expect(r.ok()).toBeTruthy();return r.json();};
    async function ask(agent:string, marker:string, provider:string, actor:Page=a) {
      await actor.getByRole("button",{name:"Select "+agent,exact:true}).click();
      await expect(actor.getByLabel("AI agent",{exact:true})).toHaveValue(agent.toLowerCase());
      await expect(actor.getByRole("button",{name:"Select "+agent,exact:true})).toHaveAttribute("aria-pressed","true");
      if(agent==="Groq") await actor.getByLabel("Approved AI model").selectOption("groq:openai/gpt-oss-20b");
      await actor.getByLabel("Message composer").fill(marker); await actor.getByRole("button",{name:"Send request to agent"}).click();
      await expect.poll(async()=> (await snapshot()).messages.filter((m:{kind:string;content:string})=>m.kind==="agent"&&m.content.includes(marker)).length).toBe(1);
      for(const page of [a,b]) await expect(page.locator("article").filter({hasText:"Mock provider response: "+provider}).filter({hasText:marker})).toBeVisible();
      console.info("ui_shared_agent_response_passed", agent, provider);
    }
    await ask("Muse","MUSE-SIDEBAR","gemini"); await ask("Gemini","GEMINI-SIDEBAR","gemini"); await ask("Groq","GROQ-SIDEBAR","groq");
    await a.getByRole("navigation",{name:"Channels",exact:true}).getByRole("link",{name:"general",exact:true}).click();
    await expect(a.getByLabel("AI agent",{exact:true})).toHaveValue("groq");
    await expect(a.locator("article").filter({hasText:"MUSE-SIDEBAR"})).toHaveCount(0);
    await a.goto(channelURL); await expect(a.getByLabel("AI agent",{exact:true})).toHaveValue("groq");
    await a.getByLabel("Message composer").fill("@Muse @Gemini ambiguous");
    await a.getByRole("button",{name:"Send request to agent"}).click();
    await expect(a.getByRole("status").filter({hasText:"Choose one agent mention"})).toBeVisible();
    await a.getByLabel("Message composer").fill("@Groq GROQ-MENTION");
    await a.getByRole("button",{name:"Send request to agent"}).click();
    await expect.poll(async()=> (await snapshot()).messages.filter((m:{kind:string;content:string})=>m.kind==="agent"&&m.content.includes("GROQ-MENTION")).length).toBe(1);
    // Owner settings broadcast immediately to both clients; members cannot alter them.
    const cfgPath=`/api/workspaces/${w.id}/ai/config`, cfg=await (await a.request.get(cfgPath)).json();
    const config={enabledProviders:cfg.enabledProviders,approvedModels:cfg.approvedModels,defaultModel:cfg.defaultModel,museModel:"groq:openai/gpt-oss-20b",allowPaid:false,userHourlyLimit:30,workspaceDailyLimit:300};
    expect((await b.request.put(cfgPath,{headers:{origin},data:config})).status()).toBe(403);
    expect((await a.request.put(cfgPath,{headers:{origin},data:config})).status()).toBe(200);
    await expect(a.getByRole("button",{name:"Select Muse",exact:true})).toContainText("Groq");
    await expect(b.getByRole("button",{name:"Select Muse",exact:true})).toContainText("Groq");
    await ask("Muse","MUSE-GROQ","groq");
    // Service failures are retained but collapsed; a later successful job still executes.
    await a.getByRole("button",{name:"Select Gemini",exact:true}).click();
    await a.getByLabel("Message composer").fill("TEST_SERVICE"); await a.getByRole("button",{name:"Send request to agent"}).click();
    await expect(a.getByText(/Failed requests \(1\)/)).toBeVisible();
    const history=a.getByTestId("agent-queue").locator("details"); await expect(history).not.toHaveAttribute("open","");
    await history.locator("summary").click(); await expect(history).toContainText("Provider service error");
    await ask("Groq","AFTER-FAILURE","groq",b);
    for(const page of [a,b]) {await page.reload();await expect(page.locator("article").filter({hasText:"Mock provider response: groq"}).filter({hasText:"MUSE-GROQ"})).toBeVisible();}
    const state=await snapshot();expect(state.jobs.filter((j:{status:string})=>["queued","running"].includes(j.status))).toHaveLength(0);
    expect(state.messages.filter((m:{kind:string})=>m.kind==="agent")).toHaveLength(6);
    expect(state.jobs.filter((j:{status:string})=>j.status==="failed")).toHaveLength(1);
  } finally { await Promise.allSettled([owner.close(),member.close()]); }
});
