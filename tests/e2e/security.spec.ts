import { expect,test } from "@playwright/test";
import { io } from "socket.io-client";
const origin="http://localhost:3000";
test("security headers, cookie attributes, CSRF origins, payload caps and socket origins are enforced",async({page,context})=>{
 const response=await page.request.get("/sign-in"),headers=response.headers();expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");expect(headers["content-security-policy"]).toContain("worker-src 'self' blob:");expect(headers["x-content-type-options"]).toBe("nosniff");expect(headers["referrer-policy"]).toBe("no-referrer");expect(headers["x-frame-options"]).toBe("DENY");
 await page.goto("/sign-in");await page.getByLabel("Mock identity").fill("security-"+Date.now().toString(36));await page.getByRole("button",{name:"Continue with Google"}).click();await expect(page).toHaveURL(origin+"/",{timeout:60000});
 const cookies=await context.cookies(),session=cookies.find(c=>c.name==="authjs.session-token");expect(session?.httpOnly).toBe(true);expect(session?.sameSite).toBe("Lax");
 for(const requestOrigin of [undefined,"https://evil.test","null"]){const r=await page.request.post("/api/workspaces",{headers:requestOrigin?{origin:requestOrigin}:{},data:{name:"Must not be created"}});expect(r.status()).toBe(403);}
 expect((await page.request.post("/api/workspaces",{headers:{origin},data:{name:"x".repeat(70000)}})).status()).toBe(413);
 const created=await page.request.post("/api/workspaces",{headers:{origin},data:{name:"Security checks"}});expect(created.status()).toBe(201);expect(created.headers()["cache-control"]).toContain("no-store");
 const socket=io(origin,{transports:["websocket"],extraHeaders:{Cookie:cookies.map(c=>c.name+"="+c.value).join("; "),Origin:"https://evil.test"},reconnection:false,timeout:5000});
 try{const outcome=await new Promise<string>(resolve=>{socket.once("connect",()=>resolve("accepted"));socket.once("connect_error",()=>resolve("rejected"));});expect(outcome).toBe("rejected");}finally{socket.close();}
 expect((await page.request.post("/__agentroom_test_shutdown",{headers:{origin}})).status()).toBe(404);expect((await page.request.get("/api/health")).status()).toBe(200);
});
