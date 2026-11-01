import { unlink } from "node:fs/promises";
import path from "node:path";
import {db} from "./db";
export const avatarRoot=path.resolve(process.env.AVATAR_DIRECTORY??"./data/avatars");
export async function removeAvatarFiles(filenames:string[]){
 if(db.kind==="postgres")return;
 for(const filename of filenames){
  if(!/^[0-9a-f-]{36}\.webp$/.test(filename))continue;
  const target=path.resolve(avatarRoot,filename);
  if(path.dirname(target)!==avatarRoot)throw new Error("Invalid avatar storage path.");
  try{await unlink(target);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")console.warn(JSON.stringify({level:"warn",event:"avatar_cleanup_failed"}));}
 }
}
