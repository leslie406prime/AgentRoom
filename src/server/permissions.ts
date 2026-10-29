export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type Action = "read" | "write" | "agent" | "artifact" | "channel:manage" | "invite" | "member:remove" | "member:role" | "workspace:manage" | "workspace:delete" | "settings" | "email:read" | "moderate";
export function can(role: Role | undefined, action: Action, resource: { targetRole?: Role; inviteRole?: Role } = {}) {
  if (!role) return false;
  if (role === "OWNER") return true;
  if (["read","write","agent","artifact"].includes(action)) return true;
  if (role !== "ADMIN") return false;
  if (action === "member:remove") return resource.targetRole === "MEMBER";
  if (action === "invite") return !resource.inviteRole || resource.inviteRole === "MEMBER";
  return ["channel:manage","email:read","moderate"].includes(action);
}
