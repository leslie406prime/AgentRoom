import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, identity: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Mock identity").fill(identity);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL("http://localhost:3000/", { timeout: 60000 });
  const sessionResponse = await page.request.get("/api/auth/session");
  const session = await sessionResponse.json() as { user?: { name?: string } };
  expect(session.user?.name).toBe(identity);
}

test("two collaborators share messages, streamed agent jobs, artifacts, and restored state", async ({ browser }) => {
  const userA = await browser.newContext();
  const userB = await browser.newContext();
  const a = await userA.newPage();
  const b = await userB.newPage();
  const runId = Date.now().toString(36);
  await signIn(a, `alex-${runId}`);
  await signIn(b, `blair-${runId}`);
  await a.goto("/");
  await a.getByRole("button", { name: /create (?:a|another) workspace/i }).click();
  await expect(a).toHaveURL(/\/workspaces\/.+\/channels\/.+/, { timeout: 60000 });
  const workspaceId = new URL(a.url()).pathname.split("/")[2];
  const invitation = await a.request.post("/api/workspaces/" + workspaceId + "/invitations", { headers: { origin: "http://localhost:3000" }, data: {} });
  expect(invitation.status()).toBe(201);
  const invite = (await invitation.json()).path;
  await expect(a.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(a.getByText("DEMO MODE", { exact: true })).toBeVisible();
  await b.goto(invite);
  await b.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(b.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15000 });

  await a.getByLabel("Message composer").fill("Let's plan a small launch.");
  await a.getByRole("button", { name: "Send message" }).click();
  await expect(b.getByText("Let's plan a small launch.")).toBeVisible();

  await b.getByRole("button", { name: /ask agent/i }).click();
  await b.getByLabel("Message composer").fill("Suggest a launch plan.");
  await b.getByRole("button", { name: "Send request to agent" }).click();
  await expect(a.getByText("writing…")).toBeVisible({ timeout: 10000 });
  await a.getByRole("button", { name: /ask agent/i }).click();
  await a.getByLabel("Message composer").fill("Give us a second short plan.");
  await a.getByRole("button", { name: "Send request to agent" }).click();
  await expect(b.getByTestId("agent-queue").getByText("Give us a second short plan.")).toBeVisible();
  await expect(a.getByTestId("agent-queue").getByText("Give us a second short plan.")).toBeVisible();
  await a.reload();
  await expect(a.getByLabel("Message composer")).toBeVisible();
  await expect(a.getByTestId("agent-queue").getByText("Give us a second short plan.")).toBeVisible({ timeout: 15000 });
  await expect(a.getByText("Here’s a practical way to get started:").first()).toBeVisible({ timeout: 30000 });
  await expect(b.getByText("Here’s a practical way to get started:").first()).toBeVisible();
  await expect(a.getByText("Here’s a practical way to get started:").nth(1)).toBeVisible({ timeout: 30000 });
  await expect(b.getByText("Here’s a practical way to get started:").nth(1)).toBeVisible({ timeout: 30000 });
  await expect(a.getByText("DEMO", { exact: true }).first()).toBeVisible();

  await expect(a.getByRole("button", { name: /Starter example/ })).toBeVisible({ timeout: 30000 });
  await expect(b.getByRole("button", { name: /Starter example/ })).toBeVisible();
  await expect(a.getByText("Agent queue")).toBeVisible();

  await a.getByRole("button", { name: "Create artifact" }).click();
  await expect(a.getByLabel("Edit document markdown")).toBeVisible();
  await a.getByLabel("Artifact title").fill("Shared notes");
  await a.getByLabel("Edit document markdown").fill("# Team notes\n\nShared in real time.");
  await a.getByRole("button", { name: "Save", exact: true }).click();
  const sharedNotesTab = b.getByRole("button", { name: /Shared notes/ });
  await expect(sharedNotesTab).toBeVisible();
  await sharedNotesTab.click();
  await expect(b.getByText("Shared in real time.")).toBeVisible();

  await a.reload();
  await expect(a.getByLabel("Message composer")).toBeVisible();
  await expect(a.getByText("Let's plan a small launch.")).toBeVisible({ timeout: 15000 });
  await expect(a.getByRole("button", { name: /Shared notes/ })).toBeVisible({ timeout: 15000 });
  await expect(a.getByText("Shared in real time.")).toBeVisible();
  await expect(a.getByRole("button", { name: /Starter example/ })).toBeVisible({ timeout: 15000 });
  await b.reload();
  await expect(b.getByLabel("Message composer")).toBeVisible();
  await expect(b.getByText("Let's plan a small launch.")).toBeVisible({ timeout: 15000 });
  await expect(b.getByRole("button", { name: /Shared notes/ })).toBeVisible({ timeout: 15000 });
  await expect(b.getByText("Shared in real time.")).toBeVisible();
  await expect(b.getByRole("button", { name: /Starter example/ })).toBeVisible({ timeout: 15000 });

  await a.reload();
  await expect(a.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(a.getByText("Let's plan a small launch.")).toBeVisible();
  const usage = await (await a.request.get("/api/workspaces/" + workspaceId + "/settings")).json();
  expect(usage.records.filter((r: { mode: string }) => r.mode === "demo").length).toBeGreaterThanOrEqual(2);
  expect(usage.usage.tokens).toBe(0);
  await userA.close();
  await userB.close();
});
