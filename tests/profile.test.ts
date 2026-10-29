import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { ProfileInput, ownProfile, touchUser, updateProfile } from "../src/server/profile-repository";
it("validates and trims 1-40 character display names",()=>{
  expect(ProfileInput.parse({name:"  Alex  "}).name).toBe("Alex");
  for(const name of [" ","a".repeat(41)]) expect(ProfileInput.safeParse({name}).success).toBe(false);
});
it("updates only the caller profile and throttles activity writes",()=>{
  const a=randomUUID(),b=randomUUID();
  for(const id of [a,b]) db.prepare('INSERT INTO "user" (id,name,email,created_at) VALUES (?,?,?,?)').run(id,"Before",id+"@test.invalid",Date.now());
  updateProfile(a,{name:" After "});
  expect(ownProfile(a)?.name).toBe("After");expect(ownProfile(b)?.name).toBe("Before");
  expect(touchUser(a,1000000)).toBe(1);expect(touchUser(a,1000001)).toBe(0);expect(touchUser(a,1180001)).toBe(1);
});
