import type { Socket } from "socket.io";
const shared=process as typeof process & { __workspaceSockets?: Set<Socket> };
const sockets=shared.__workspaceSockets ??= new Set<Socket>();
export function trackWorkspaceSocket(socket: Socket) { sockets.add(socket); socket.once("disconnect",()=>sockets.delete(socket)); }
export function evictWorkspaceUser(workspaceId: string, userId?: string) {
  for(const socket of sockets) if(socket.data.workspaceId===workspaceId && (!userId || socket.data.userId===userId)) socket.disconnect(true);
}
export function notifyWorkspaceAI(workspaceId:string,config:unknown){for(const socket of sockets)if(socket.data.workspaceId===workspaceId)socket.emit("workspace:ai",config);}
export function emitChannel(channelId:string,event:string,payload:unknown){for(const socket of sockets)if(socket.data.roomId===channelId)socket.emit(event,payload);}
