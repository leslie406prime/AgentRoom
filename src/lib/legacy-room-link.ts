// An original room ID is a private capability. Never enumerate unclaimed links.
export function legacyRoomPath(value: string, origin: string) {
  try {
    const url = new URL(value.trim(), origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/room\/[A-Za-z0-9_-]{12,64}\/?$/.test(url.pathname)) return null;
    return url.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
}
