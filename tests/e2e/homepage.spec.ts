import { expect, test, type Page } from "@playwright/test";
import { testDatabase } from "./test-database";

const origin = "http://localhost:3000";
async function login(page: Page, identity: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Mock identity").fill(identity);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(origin + "/");
  return (await (await page.request.get("/api/auth/session")).json()).user.id as string;
}

test("homepage follows the cookie-backed session, workspace selection, refresh, and sign out", async ({ page }) => {
  const identity = "home-" + Date.now().toString(36);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Your workspaces" })).toHaveCount(0);
  await expect(page.getByLabel("Original room link")).toHaveCount(0);
  expect((await page.request.get("/api/workspaces")).status()).toBe(401);

  const id = await login(page, identity);
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=";
  const database = testDatabase();
  try { database.prepare('UPDATE "user" SET image=? WHERE id=?').run(image, id); } finally { database.close(); }
  await page.reload();
  await expect(page.getByLabel("Account for " + identity, { exact: true })).toBeVisible();
  await expect(page.getByText(identity, { exact: true })).toBeVisible();
  await expect(page.getByAltText(identity + "'s profile picture")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create a workspace", exact: true })).toBeVisible();
  const workspaces = [];
  for (const name of ["First home workspace", "Second home workspace"]) {
    const response = await page.request.post("/api/workspaces", { headers: { origin }, data: { name } });
    expect(response.status()).toBe(201);
    workspaces.push(await response.json());
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Create another workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open workspace", exact: true })).toHaveAttribute("href", "/workspaces/" + workspaces[0].id + "/channels/" + workspaces[0].channelId);
  await page.getByLabel("Choose workspace").selectOption(workspaces[1].id);
  await page.getByRole("link", { name: "Open workspace", exact: true }).click();
  await expect(page).toHaveURL(origin + "/workspaces/" + workspaces[1].id + "/channels/" + workspaces[1].channelId);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "AgentRoom home" }).click();
  await expect(page.getByLabel("Account for " + identity, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("Account for " + identity, { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(origin + "/");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Your workspaces" })).toHaveCount(0);
  const response = await page.request.get("/");
  expect(await response.text()).not.toContain("First home workspace");
  expect((await page.request.get("/api/workspaces")).status()).toBe(401);
});
