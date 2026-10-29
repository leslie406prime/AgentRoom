import type { Socket } from "socket.io";

const shared = process as typeof process & { __agentroomSessions?: Map<string, Set<Socket>> };
const sessionSockets = shared.__agentroomSessions ??= new Map<string, Set<Socket>>();

export function registerSessionSocket(sessionToken: string, socket: Socket) {
  const sockets = sessionSockets.get(sessionToken) ?? new Set<Socket>();
  sockets.add(socket);
  sessionSockets.set(sessionToken, sockets);
}

export function unregisterSessionSocket(sessionToken: string, socket: Socket) {
  const sockets = sessionSockets.get(sessionToken);
  sockets?.delete(socket);
  if (!sockets?.size) sessionSockets.delete(sessionToken);
}

export function disconnectSessionSockets(sessionToken: string) {
  const sockets = sessionSockets.get(sessionToken);
  if (!sockets) return;
  sessionSockets.delete(sessionToken);
  for (const socket of sockets) socket.disconnect(true);
}
