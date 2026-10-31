import { request } from "@playwright/test";
export default async function setup() {
  const client = await request.newContext({ baseURL: "http://localhost:3101", timeout: 120000 });
  for (const route of ["/sign-in", "/api/auth/providers", "/api/auth/csrf", "/api/workspaces", "/api/workspaces/warmup/ai/config", "/api/workspaces/warmup/invitations", "/api/invitations/warmup", "/workspaces/warmup/channels/warmup", "/api/workspaces/warmup/channels/warmup", "/api/workspaces/warmup/settings", "/api/mock-oauth/authorize"]) await client.get(route);
  await client.post("/api/mock-oauth/token", { form: {} });
  await client.dispose();
}
