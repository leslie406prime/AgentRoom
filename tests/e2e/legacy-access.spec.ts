import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { testDatabase } from "./test-database";

const origin = "http://localhost:3000";
function legacyFixture() {
  const database = testDatabase();
  const room = randomUUID(), workspace = randomUUID(), member = randomUUID(), job = randomUUID(), artifact = randomUUID();
  try {
    database.transaction(() => {
      database.prepare("INSERT INTO workspaces(id,name,unclaimed_legacy,created_at) VALUES (?,'Legacy browser fixture',1,?)").run(workspace,Date.now());
      database.prepare("INSERT INTO rooms(id,name,created_at,next_seq) VALUES (?,'Legacy browser fixture','2024-01-01',9)").run(room);
      database.prepare("INSERT INTO channels(id,workspace_id,name,is_general) VALUES (?,?,'general',1)").run(room,workspace);
      database.prepare("INSERT INTO legacy_room_links(old_room_id,channel_id) VALUES (?,?)").run(room,room);
      database.prepare("INSERT INTO members(id,room_id,name,color,created_at,last_seen) VALUES (?,?,'Original author','#555555','2024-01-01','2024-01-01')").run(member,room);
      database.prepare("INSERT INTO agent_jobs(id,room_id,requester_id,requester_name,prompt,idempotency_key,status,created_at,updated_at) VALUES (?,?,?,'Original author','Synthetic historical prompt',?,'completed','2024-01-01','2024-01-02')").run(job,room,member,randomUUID());
      database.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq) VALUES (?,?,?,'Original author','Historical human browser fixture','human','2024-01-01T10:00:00Z',3)").run(randomUUID(),room,member);
      database.prepare("INSERT INTO messages(id,room_id,author_id,author_name,content,kind,created_at,seq,job_id) VALUES (?,?,'agent','Room agent','Historical AI browser fixture','agent','2024-01-02T10:00:00Z',7,?)").run(randomUUID(),room,job);
      database.prepare("INSERT INTO room_events(room_id,seq,type,payload,created_at) VALUES (?,9,'artifact',?,'2024-01-02')").run(room,JSON.stringify({id:artifact,title:"Historical notes",type:"document",language:"markdown",content:"Historical artifact browser fixture",version:2,updatedBy:"Original author",updatedAt:"2024-01-02T10:00:00Z"}));
      database.prepare("INSERT INTO artifacts(id,room_id,title,type,language,content,version,updated_by,updated_at) VALUES (?,?,'Historical notes','document','markdown','Historical artifact browser fixture',2,'Original author','2024-01-02T10:00:00Z')").run(artifact,room);
      database.prepare("INSERT INTO artifact_versions(room_id,artifact_id,version,title,type,language,content,updated_by,updated_at) VALUES (?,?,1,'Historical notes','document','markdown','Earlier artifact browser fixture','Original author','2024-01-01T10:00:00Z')").run(room,artifact);
    }).immediate();
  } finally { database.close(); }
  return { room,workspace,member,job,artifact };
}
function history(room: string) {
  const database = testDatabase();
  try {
    return Object.fromEntries(["rooms","members","room_events","messages","agent_jobs","artifacts","artifact_versions"].map(table => [
      table,
      database.prepare('SELECT * FROM '+table+' WHERE '+(table==="rooms"?"id":"room_id")+'=?'+(table==="members"?" AND user_id IS NULL":"")+' ORDER BY rowid').all(room),
    ]));
  } finally { database.close(); }
}

test("original links require sign-in, claim once, preserve history, and reject another account", async ({ browser }) => {
  const fixture = legacyFixture(), before = history(fixture.room);
  const owner = await browser.newContext(), outsider = await browser.newContext();
  try {
    const page = await owner.newPage(), other = await outsider.newPage(), run = Date.now().toString(36);
    const link = "/room/" + fixture.room;
    await page.goto(link);
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=/);
    await page.getByLabel("Mock identity").fill("legacy-owner-" + run);
    await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect(page).toHaveURL(origin + "/workspaces/" + fixture.workspace + "/channels/" + fixture.room);
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("Historical human browser fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Historical AI browser fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Historical artifact browser fixture", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show version history" }).click();
    await expect(page.getByText("Version 1", { exact: false })).toBeVisible();
    expect(history(fixture.room)).toEqual(before);
    await page.reload();
    await expect(page.getByText("Historical human browser fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Historical artifact browser fixture", { exact: true })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Your workspaces" }).getByRole("link", { name: "Legacy browser fixture", exact: true })).toBeVisible();
    await page.getByLabel("Original room link").fill(origin + link);
    await page.getByRole("button", { name: "Open previous conversation", exact: true }).click();
    await expect(page).toHaveURL(origin + "/workspaces/" + fixture.workspace + "/channels/" + fixture.room);
    await expect(page.getByText("Historical human browser fixture", { exact: true })).toBeVisible();
    expect(history(fixture.room)).toEqual(before);

    await other.goto("/sign-in");
    await other.getByLabel("Mock identity").fill("legacy-outsider-" + run);
    await other.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect(other).toHaveURL(origin + "/");
    const listing = await (await other.request.get("/api/workspaces")).json() as {id:string}[];
    expect(listing.some(workspace=>workspace.id===fixture.workspace)).toBe(false);
    expect((await other.request.get("/api/workspaces/" + fixture.workspace + "/channels/" + fixture.room)).status()).toBe(404);
    const denied = await other.goto(link);
    expect(denied?.status()).toBe(404);
    expect(history(fixture.room)).toEqual(before);
    const database = testDatabase();
    try {
      expect(database.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id=?").get(fixture.workspace)).toEqual({n:1});
      expect(database.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id=? AND action='legacy:claim'").get(fixture.workspace)).toEqual({n:1});
    } finally { database.close(); }
  } finally { await owner.close(); await outsider.close(); }
});
