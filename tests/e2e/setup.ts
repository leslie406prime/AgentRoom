import { request } from "@playwright/test";
export default async function setup() {
  const client=await request.newContext({baseURL:"http://localhost:3000",timeout:120000});
  for(const path of ["/sign-in","/api/auth/providers","/api/auth/csrf","/profile","/room/warmup-room-12345","/workspaces/warmup-workspace/channels/warmup-channel","/workspaces/warmup-workspace","/api/profile/identities","/api/workspaces","/api/workspaces/warmup/invitations","/api/invitations/warmup","/api/workspaces/warmup/ai/config","/api/workspaces/warmup/ai","/api/workspaces/warmup/settings","/api/mock-oauth/authorize","/api/mock-oauth/userinfo"]) await client.get(path);
  // Compile owner routes before test timers start; unauthenticated warmups cannot alter settings or call providers.
  await client.post("/api/workspaces/warmup/ai/verify");
  await client.post("/api/mock-oauth/token",{form:{}});
  await client.dispose();
}
