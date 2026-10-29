import { apiActor } from "@/server/api-session";
import { apiError,HttpError,rateLimit } from "@/server/http-security";
import { readWorkspaceAvatar,saveWorkspaceAvatar } from "@/server/avatar-repository";
type Context={params:Promise<{id:string}>};
export async function POST(request:Request,{params}:Context){
 try{
  const actor=await apiActor(request);rateLimit("avatar:"+actor,5);
  if(Number(request.headers.get("content-length")??0)>1048576)throw new HttpError(413,"Avatar must be at most 1 MB.");
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,"Image required.");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1048576){await reader.cancel();throw new HttpError(413,"Avatar must be at most 1 MB.");}chunks.push(part.value);}
  await saveWorkspaceAvatar(actor,(await params).id,Buffer.concat(chunks));return Response.json({ok:true});
 }catch(e){return apiError(e);}
}
export async function GET(_r:Request,{params}:Context){try{const bytes=await readWorkspaceAvatar(await apiActor(),(await params).id);return new Response(new Uint8Array(bytes),{headers:{"content-type":"image/webp","x-content-type-options":"nosniff","cache-control":"private, no-store"}});}catch(e){return apiError(e);}}
