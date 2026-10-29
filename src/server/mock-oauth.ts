import { createHash,randomBytes,timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { appOrigin,readLimitedBody } from "./http-security";
type MockProviderId="mock-google";
type MockProfile={sub:string;name:string;email:string;email_verified:boolean;picture:null};
type PendingCode={provider:MockProviderId;profile:MockProfile;redirectUri:string;challenge:string;expiresAt:number};
type Store={codes:Map<string,PendingCode>;tokens:Map<string,{profile:MockProfile;expiresAt:number}>};
const shared=process as typeof process & {__agentroomMockOAuth?:Store};
const {codes,tokens}=shared.__agentroomMockOAuth??={codes:new Map(),tokens:new Map()};
const clients:Record<string,MockProviderId>={"agentroom-mock-google":"mock-google"};
const Authorization=z.object({client_id:z.literal("agentroom-mock-google"),redirect_uri:z.string().max(2048),state:z.string().min(16).max(4096),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_challenge_method:z.literal("S256"),response_type:z.literal("code"),login_hint:z.string().regex(/^[a-zA-Z0-9._-]{1,48}$/).default("demo-user")});
const TokenRequest=z.object({code:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),redirect_uri:z.string().max(2048),grant_type:z.literal("authorization_code"),client_id:z.string().max(100).optional(),client_secret:z.string().max(128).optional()});
export function mockOAuthEnabled(){return process.env.AUTH_MOCK_OAUTH_ENABLED==="true";}
export function assertMockOAuthEnvironment(){if(mockOAuthEnabled()&&process.env.NODE_ENV==="production")throw new Error("AUTH_MOCK_OAUTH_ENABLED cannot be enabled in production.");}
function enabled(){return mockOAuthEnabled()&&process.env.NODE_ENV!=="production";}
function prune(){const now=Date.now();for(const [key,value] of codes)if(value.expiresAt<=now)codes.delete(key);for(const [key,value] of tokens)if(value.expiresAt<=now)tokens.delete(key);}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
export function authorizeMockOAuth(request:NextRequest){
 if(!enabled())return new Response(null,{status:404});
 try{
  prune();if(codes.size>=1000)return new Response("Try again later.",{status:429});
  const input=Authorization.parse(Object.fromEntries(request.nextUrl.searchParams)),provider=clients[input.client_id];
  const callback=new URL(input.redirect_uri),path="/api/auth/callback/"+provider;
  if(callback.origin!==appOrigin()||callback.pathname!==path||callback.search||callback.hash)return new Response("Invalid OAuth callback.",{status:400});
  const hint=input.login_hint,profile:MockProfile={sub:hint,name:hint,email:hint+"@example.test",email_verified:true,picture:null};
  const code=randomBytes(32).toString("base64url");codes.set(code,{provider,profile,redirectUri:input.redirect_uri,challenge:input.code_challenge,expiresAt:Date.now()+60000});
  const destination=new URL(input.redirect_uri);destination.searchParams.set("code",code);destination.searchParams.set("state",input.state);return new Response(null,{status:303,headers:{location:destination.toString(),"cache-control":"no-store"}});
 }catch{return new Response("Invalid mock OAuth request.",{status:400});}
}
export async function exchangeMockOAuth(request:NextRequest){
 if(!enabled())return new Response(null,{status:404});
 try{
  prune();if(request.headers.get("content-type")?.split(";")[0]!=="application/x-www-form-urlencoded")return json({error:"invalid_request"},400);
  const input=TokenRequest.parse(Object.fromEntries(new URLSearchParams(new TextDecoder("utf-8",{fatal:true}).decode(await readLimitedBody(request,16384)))));
  let clientId=input.client_id??"",secret=input.client_secret??"";const header=request.headers.get("authorization");
  if(header){const match=header.match(/^Basic ([A-Za-z0-9+/]+=*)$/i);if(!match)return json({error:"invalid_client"},401);const decoded=Buffer.from(match[1],"base64").toString("utf8"),separator=decoded.indexOf(":");clientId=decoded.slice(0,separator);secret=decoded.slice(separator+1);}
  const expectedSecret=Buffer.from("agentroom-mock-secret"),actualSecret=Buffer.from(secret),provider=clients[clientId];
  if(!provider||actualSecret.length!==expectedSecret.length||!timingSafeEqual(actualSecret,expectedSecret))return json({error:"invalid_client"},401);
  const pending=codes.get(input.code);
  if(!pending||pending.expiresAt<=Date.now()||pending.provider!==provider||pending.redirectUri!==input.redirect_uri)return json({error:"invalid_grant"},400);
  const expected=Buffer.from(pending.challenge),actual=Buffer.from(createHash("sha256").update(input.code_verifier).digest("base64url"));
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return json({error:"invalid_grant"},400);
  if(tokens.size>=1000)return json({error:"temporarily_unavailable"},429);
  codes.delete(input.code);const accessToken=randomBytes(32).toString("base64url");tokens.set(accessToken,{profile:pending.profile,expiresAt:Date.now()+3600000});return json({access_token:accessToken,token_type:"Bearer",expires_in:3600});
 }catch{return json({error:"invalid_request"},400);}
}
export function mockOAuthUserInfo(request:NextRequest){
 if(!enabled())return new Response(null,{status:404});prune();const token=request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],entry=token?tokens.get(token):undefined;
 return !entry||entry.expiresAt<=Date.now()?json({error:"invalid_token"},401):json(entry.profile);
}
