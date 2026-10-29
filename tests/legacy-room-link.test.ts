import { expect, it } from "vitest";
import { legacyRoomPath } from "../src/lib/legacy-room-link";

const origin = "http://localhost:3000";
it("accepts an original private room link without navigating to an external site", () => {
  expect(legacyRoomPath("/room/original-room-1234", origin)).toBe("/room/original-room-1234");
  expect(legacyRoomPath(origin + "/room/original-room-1234/", origin)).toBe("/room/original-room-1234");
});
it.each([
  "", "/workspaces/private-workspace", "/room/short", "/room/original-room-1234?claim=all",
  "/room/original-room-1234#extra", "https://other.example/room/original-room-1234",
  "//other.example/room/original-room-1234", "javascript:alert(1)",
  "http://user:password@localhost:3000/room/original-room-1234",
  "/room/original-room-1234/more",
])("rejects invalid or external legacy destinations (%#)", value => {
  expect(legacyRoomPath(value, origin)).toBeNull();
});
