import { request } from "@playwright/test";
export default async function setup() {
  const client=await request.newContext({baseURL:"http://localhost:3000",timeout:120000});
  for(const path of ["/sign-in","/api/auth/providers","/api/auth/csrf","/profile","/room/warmup-room-12345","/workspaces/warmup-workspace/channels/warmup-channel","/api/profile/identities","/api/workspaces","/api/workspaces/warmup/invitations","/api/invitations/warmup","/api/mock-oauth/authorize","/api/mock-oauth/userinfo"]) await client.get(path);
  await client.post("/api/mock-oauth/token",{form:{}});
  await client.dispose();
}
