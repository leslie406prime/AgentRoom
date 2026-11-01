import { afterEach,expect,it,vi } from "vitest";
import { z } from "zod";
import { assertOrigin,readInput,resourceId,rateLimit } from "../src/server/http-security";
afterEach(()=>vi.unstubAllEnvs());
it("validates origins against configuration rather than request Host",()=>{
 vi.stubEnv("AUTH_URL","https://app.example.test");for(const origin of ["https://evil.test","null","https://app.example.test.evil.test"]){expect(()=>assertOrigin(new Request("https://app.example.test/api",{method:"POST",headers:{origin}}))).toThrow();}
 expect(()=>assertOrigin(new Request("https://app.example.test/api",{method:"POST",headers:{origin:"https://app.example.test"}}))).not.toThrow();
});
it("rejects malformed resource IDs and structured payloads",async()=>{
 for(const id of ["../other", "x".repeat(65),"bad/resource/identifier"]){expect(()=>resourceId(id)).toThrow("Not found");}
 const schema=z.object({name:z.string().min(1).max(40)}).strict();
 await expect(readInput(new Request("http://localhost/api",{method:"POST",headers:{"content-type":"application/json"},body:'{"name":"Valid","role":"OWNER"}'}),schema)).rejects.toThrow("Invalid input");
 await expect(readInput(new Request("http://localhost/api",{method:"POST",body:'{"name":"Valid"}'}),schema)).rejects.toThrow("application/json");
});
it("enforces actual streamed JSON size without trusting Content-Length",async()=>{
 let canceled=false;const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(40000));},cancel(){canceled=true;}});
 const request=new Request("http://localhost/api",{method:"POST",headers:{"content-type":"application/json","content-length":"1"},body:stream,duplex:"half"} as RequestInit & {duplex:"half"});
 await expect(readInput(request,z.unknown())).rejects.toThrow("Request too large");expect(canceled).toBe(true);
});
it("rate limits repeated actions in a bounded time window",()=>{const key="limit-"+crypto.randomUUID();rateLimit(key,2);rateLimit(key,2);expect(()=>rateLimit(key,2)).toThrow("Too many");});
