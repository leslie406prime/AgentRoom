import { z } from "zod";
const shared=process as typeof process & {__agentroomRates?:Map<string,{count:number;reset:number}>};
const buckets=shared.__agentroomRates??=new Map<string,{count:number;reset:number}>();
export function rateLimit(key:string,limit=30,window=60000){
 const now=Date.now();if(buckets.size>10000)for(const [key,value] of buckets)if(value.reset<=now)buckets.delete(key);
 const bucket=buckets.get(key);if(!bucket||bucket.reset<=now){buckets.set(key,{count:1,reset:now+window});return;}
 if(++bucket.count>limit)throw new HttpError(429,"Too many requests. Please wait.");
}
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
export function appOrigin(){return new URL(process.env.AUTH_URL??"http://localhost:"+(process.env.PORT??"3000")).origin;}
export function assertOrigin(request:Request){if(request.headers.get("origin")!==appOrigin())throw new HttpError(403,"Invalid request origin.");}
export const ResourceId=z.string().min(12).max(64).regex(/^[A-Za-z0-9_-]+$/);
export function resourceId(value:unknown){const parsed=ResourceId.safeParse(value);if(!parsed.success)throw new HttpError(404,"Not found.");return parsed.data;}
export async function readLimitedBody(request:Request,max:number){
 if(Number(request.headers.get("content-length")??0)>max)throw new HttpError(413,"Request too large.");
 const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks:Uint8Array[]=[];let bytes=0;
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();throw new HttpError(413,"Request too large.");}chunks.push(part.value);}
 return Buffer.concat(chunks,bytes);
}
export async function readInput<T>(request:Request,schema:z.ZodType<T>){
 if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new HttpError(415,"Use application/json.");
 const bytes=await readLimitedBody(request,65536);
 try{return schema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));}catch{throw new HttpError(400,"Invalid input.");}
}
export function apiError(error:unknown){return Response.json({error:error instanceof HttpError?error.message:error instanceof z.ZodError?"Invalid input.":"The request could not be completed."},{status:error instanceof HttpError?error.status:error instanceof z.ZodError?400:500,headers:{"cache-control":"private, no-store"}});}
