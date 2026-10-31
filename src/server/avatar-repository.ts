import { z } from "zod";
import { avatarRoot,removeAvatarFiles } from "./avatar-storage";
﻿import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { audit,requireRole } from "./workspace-repository";
import { HttpError } from "./http-security";
const root=avatarRoot;
export async function saveWorkspaceAvatar(actor:string,workspace:string,bytes:Buffer) {
 (await requireRole(actor,workspace,"workspace:manage"));
 z.instanceof(Buffer).parse(bytes);
 if(bytes.length>1048576)throw new HttpError(413,"Avatar must be at most 1 MB.");
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";
 if(!png&&!jpeg&&!webp)throw new HttpError(400,"Use a PNG, JPEG or WebP image.");
 let output:Buffer;
 try {
  const image=sharp(bytes,{limitInputPixels:16000000,pages:1});
  const metadata=await image.metadata();
  if(!["png","jpeg","webp"].includes(metadata.format??""))throw new Error("Unsupported image");
  output=await image.rotate().resize(256,256,{fit:"cover"}).webp({quality:80}).toBuffer();
 }catch{throw new HttpError(400,"The image could not be decoded.");}
 const filename=randomUUID()+".webp";
 if(db.kind==="sqlite"){await mkdir(root,{recursive:true});await writeFile(path.join(root,filename),output,{flag:"wx"});}
 let obsolete:string[]=[];
 try {
  obsolete=(await db.transaction(async ()=>{
   (await requireRole(actor,workspace,"workspace:manage"));
   const prior=(await db.prepare("SELECT filename FROM workspace_avatar_files WHERE workspace_id=?").all(workspace)) as {filename:string}[];
   (await db.prepare("DELETE FROM workspace_avatar_files WHERE workspace_id=?").run(workspace));
   (await db.prepare("INSERT INTO workspace_avatar_files(filename,workspace_id,created_at) VALUES (?,?,?)").run(filename,workspace,Date.now()));
   if(db.kind==="postgres")await db.prepare("INSERT INTO workspace_avatar_blobs(filename,content) VALUES (?,?)").run(filename,output);
   (await db.prepare("UPDATE workspaces SET avatar=? WHERE id=?").run(filename,workspace));(await audit(workspace,actor,"workspace:avatar"));return prior.map(p=>p.filename);
  }).immediate());
 } catch(error){await removeAvatarFiles([filename]);throw error;}
 await removeAvatarFiles(obsolete);
}
export async function readWorkspaceAvatar(actor:string,workspace:string) {
 (await requireRole(actor,workspace));
 const row=(await db.prepare("SELECT avatar FROM workspaces WHERE id=?").get(workspace)) as {avatar:string};
 if(!/^[0-9a-f-]{36}\.webp$/.test(row.avatar))throw new HttpError(404,"Not found.");
 if(db.kind==="postgres"){
   const blob=await db.prepare("SELECT content FROM workspace_avatar_blobs WHERE filename=?").get(row.avatar);
   if(!blob||!Buffer.isBuffer(blob.content))throw new HttpError(404,"Not found.");return blob.content;
 }
 try{return await readFile(path.join(root,row.avatar));}catch{throw new HttpError(404,"Not found.");}
}
