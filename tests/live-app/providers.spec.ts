import { expect, test, type Page } from "@playwright/test";

const origin = "http://localhost:3101";
const geminiModel = process.env.AGENTROOM_LIVE_GEMINI_MODEL ?? "gemini-3.5-flash-lite";
async function login(page: Page, name: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Mock identity").fill(name);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(origin + "/");
}

test("real Gemini, Groq and Muse replies traverse browser sockets, queue, shared channel and durable replay", async ({ browser }) => {
  const ownerContext = await browser.newContext(), memberContext = await browser.newContext();
  const owner = await ownerContext.newPage(), member = await memberContext.newPage();
  const run = Date.now().toString(36);
  try {
    await login(owner, "live-owner-" + run); await login(member, "live-member-" + run);
    const created = await owner.request.post("/api/workspaces", { headers: { origin }, data: { name: "Live application verification" } });
    expect(created.status()).toBe(201); const w = await created.json();
    const configPath = `/api/workspaces/${w.id}/ai/config`;
    const config = await (await owner.request.get(configPath)).json();
    expect(config.providers.every((p: { configured: boolean }) => p.configured)).toBe(true);
    expect(config.allowPaid).toBe(false);
    const invitation = await owner.request.post(`/api/workspaces/${w.id}/invitations`, { headers: { origin }, data: {} });
    const invite = await invitation.json();
    expect((await member.request.post("/api/invitations/" + invite.path.split("/").at(-1), { headers: { origin } })).status()).toBe(200);
    const channelPath = `/workspaces/${w.id}/channels/${w.channelId}`;
    const snapshotPath = `/api/workspaces/${w.id}/channels/${w.channelId}`;
    await owner.goto(channelPath); await member.goto(channelPath);
    for (const page of [owner, member]) await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await owner.getByLabel("Message composer").fill("Decision: the release code is APP-MUSE-42.");
    await owner.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(member.getByText("Decision: the release code is APP-MUSE-42.", { exact: true })).toBeVisible();
    async function ask(agent: "gemini" | "agent" | "muse", marker: string, model?: string) {
      const toggle = owner.getByRole("button", { name: "Ask agent", exact: true });
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await owner.getByLabel("AI agent", { exact: true }).selectOption(agent);
      if (model) await owner.getByLabel("Approved AI model", { exact: true }).selectOption(model);
      await owner.getByLabel("Message composer").fill(agent === "muse" ? `What release code did we decide? Reply with the code and ${marker}.` : `Reply with exactly ${marker}.`);
      const previous = await (await owner.request.get(snapshotPath)).json();
      const previousJobs = new Set(previous.jobs.map((j: { id: string }) => j.id));
      const before = previous.messages.filter((m: { kind: string }) => m.kind === "agent").length;
      await owner.getByRole("button", { name: "Send request to agent", exact: true }).click();
      let response: { id: string; content: string; provider: string; model: string; agent: string } | undefined;
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline && !response) {
        let snapshot;
        try { snapshot = await (await owner.request.get(snapshotPath, { timeout: 8000, maxRetries: 2 })).json(); }
        catch { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
        const failed = snapshot.jobs?.find((j: { id: string; status: string }) => j.status === "failed" && !previousJobs.has(j.id));
        if (failed) throw new Error(`Application job failed: ${failed.error}`);
        const replies = snapshot.messages.filter((m: { kind: string }) => m.kind === "agent");
        if (replies.length > before) response = replies.at(-1);
        if (!response) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      expect(response, "The actual queued request must complete with a persisted response").toBeDefined();
      expect(response?.content).toContain(marker);
      expect(response?.agent).toBe(agent);
      if (agent === "muse") expect(response?.content).toContain("APP-MUSE-42");
      for (const page of [owner, member]) {
        await expect(page.locator('section[aria-label="Channel conversation"] article').filter({ has: page.locator('span[title="Provider and model that generated this response"]') }).filter({ hasText: marker })).toBeVisible();
      }
      console.info(JSON.stringify({ event: "live_app_reply_verified", agent, provider: response!.provider, model: response!.model, shared: true }));
      return { ...response!, marker };
    }
    const replies = [];
    replies.push(await ask("gemini", "APP-GEMINI-OK", "gemini:" + geminiModel));
    // Match an explicitly selected approved Gemini model in this isolated workspace only.
    const museGeminiSettings = { enabledProviders: config.enabledProviders, approvedModels: config.approvedModels, defaultModel: config.defaultModel, museModel: "gemini:" + geminiModel, allowPaid: false, userHourlyLimit: config.userHourlyLimit, workspaceDailyLimit: config.workspaceDailyLimit };
    expect((await owner.request.put(configPath, { headers: { origin }, data: museGeminiSettings })).status()).toBe(200);
    replies.push(await ask("muse", "APP-MUSE-GEMINI-OK"));
    replies.push(await ask("agent", "APP-GROQ-OK", "groq:openai/gpt-oss-20b"));
    // Change only this isolated test workspace, through the owner-authorized API.
    const settings = { enabledProviders: config.enabledProviders, approvedModels: config.approvedModels, defaultModel: config.defaultModel, museModel: "groq:openai/gpt-oss-20b", allowPaid: false, userHourlyLimit: config.userHourlyLimit, workspaceDailyLimit: config.workspaceDailyLimit };
    expect((await owner.request.put(configPath, { headers: { origin }, data: settings })).status()).toBe(200);
    replies.push(await ask("muse", "APP-MUSE-OK"));
    // Probe the original failing model without substituting it. A real provider outage must
    // become a useful visible failure, then the next approved Groq job must run.
    let defaultRejected = false;
    try { replies.push(await ask("gemini", "APP-DEFAULT-PROBE", "gemini:gemini-3.8-flash")); }
    catch (error) {
      expect((error as Error).message).toMatch(/provider service error|request timed out|quota limit/i);
      await expect(owner.getByTestId("agent-queue").getByText(/provider service error|request timed out|quota limit/i).first()).toBeVisible();
      defaultRejected = true;
      console.info(JSON.stringify({ event: "live_app_rejection_verified", model: "gemini-3.8-flash", visibleSafeError: true }));
    }
    replies.push(await ask("agent", "APP-QUEUE-CONTINUES", "groq:openai/gpt-oss-20b"));
    for (const page of [owner, member]) {
      await page.reload(); await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      const snapshot = await (await page.request.get(snapshotPath)).json();
      for (const reply of replies) expect(snapshot.messages.some((m: { id: string }) => m.id === reply.id)).toBe(true);
      for (const reply of replies) await expect(page.locator('section[aria-label="Channel conversation"] article').filter({ has: page.locator('span[title="Provider and model that generated this response"]') }).filter({ hasText: reply.marker })).toBeVisible();
      expect(snapshot.jobs.filter((job: { status: string }) => ["running", "queued"].includes(job.status))).toHaveLength(0);
      expect(snapshot.jobs.filter((job: { status: string }) => job.status === "failed")).toHaveLength(defaultRejected ? 1 : 0);
      const html = await page.content();
      expect(html.includes(process.env.GEMINI_API_KEY!)).toBe(false); expect(html.includes(process.env.GROQ_API_KEY!)).toBe(false);
    }
    const usage = await (await owner.request.get(`/api/workspaces/${w.id}/settings`)).json();
    expect(usage.records).toHaveLength(6);
    expect(usage.records.filter((r: { status: string; inputTokens: number }) => r.status === "completed" && r.inputTokens > 0)).toHaveLength(replies.length);
    expect((await (await owner.request.get(configPath)).json()).defaultModel).toBe(config.defaultModel);
    console.info(JSON.stringify({ event: "live_app_persistence_verified", replies: replies.length, rejectedDefault: defaultRejected, queueContinues: true, refresh: true, usage: true, paidAuthorized: false }));
  } finally { await ownerContext.close(); await memberContext.close(); }
});
