import { afterEach,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash,randomBytes } from "node:crypto";
import { authorizeMockOAuth,exchangeMockOAuth,mockOAuthUserInfo } from "../src/server/mock-oauth";
const origin="http://localhost:3000",secret="agentroom-mock-secret";
afterEach(()=>vi.unstubAllEnvs());
function enable(){vi.stubEnv("AUTH_MOCK_OAUTH_ENABLED","true");vi.stubEnv("AUTH_URL",origin);}
function code(provider="mock-google"){
 const verifier=randomBytes(32).toString("base64url"),challenge=createHash("sha256").update(verifier).digest("base64url"),redirect=origin+"/api/auth/callback/"+provider;
 const query=new URLSearchParams({client_id:"agentroom-"+provider,redirect_uri:redirect,state:"safe-state-12345678901234567890",code_challenge:challenge,code_challenge_method:"S256",response_type:"code",login_hint:"security-test"});
 const response=authorizeMockOAuth(new NextRequest(origin+"/api/mock-oauth/authorize?"+query));expect(response.status).toBe(303);
 return {code:new URL(response.headers.get("location")!).searchParams.get("code")!,verifier,redirect};
}
function request(input:ReturnType<typeof code>,provider="mock-google",verifier=input.verifier,password=secret){return new NextRequest(origin+"/api/mock-oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",authorization:"Basic "+Buffer.from("agentroom-"+provider+":"+password).toString("base64")},body:new URLSearchParams({grant_type:"authorization_code",code:input.code,code_verifier:verifier,redirect_uri:input.redirect})});}
it("binds authorization codes to client identity, PKCE and single redemption",async()=>{
 enable();const input=code();expect((await exchangeMockOAuth(request(input,"mock-microsoft"))).status).toBe(401);expect((await exchangeMockOAuth(request(input,"mock-google",input.verifier,"wrong-secret"))).status).toBe(401);expect((await exchangeMockOAuth(request(input,"mock-google","x".repeat(43)))).status).toBe(400);
 const response=await exchangeMockOAuth(request(input));expect(response.status).toBe(200);const token=(await response.json()).access_token;expect(mockOAuthUserInfo(new NextRequest(origin+"/api/mock-oauth/userinfo",{headers:{authorization:"Bearer "+token}})).status).toBe(200);expect((await exchangeMockOAuth(request(input))).status).toBe(400);
});
it("refuses mock OAuth in production even if the flag is enabled",async()=>{
 enable();vi.stubEnv("NODE_ENV","production");expect(authorizeMockOAuth(new NextRequest(origin+"/api/mock-oauth/authorize")).status).toBe(404);expect((await exchangeMockOAuth(new NextRequest(origin+"/api/mock-oauth/token",{method:"POST"}))).status).toBe(404);expect(mockOAuthUserInfo(new NextRequest(origin+"/api/mock-oauth/userinfo")).status).toBe(404);
});
