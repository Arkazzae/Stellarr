import { describe, expect, it } from "vitest";

import type { User } from "@/ports";

import { relationTo } from "./relationTo";

function user(id: string): User {
  return { id, username: id, displayName: id, presence: "online" };
}

const social = {
  friends: [{ user: user("friend"), since: "2026-01-01T00:00:00.000Z" }],
  requests: [
    { id: "r-1", user: user("asked"), direction: "incoming" as const, sentAt: "2026-01-01T00:00:00.000Z" },
    { id: "r-2", user: user("waiting"), direction: "outgoing" as const, sentAt: "2026-01-01T00:00:00.000Z" },
  ],
  blocked: [user("blocked")],
};

describe("relationTo", () => {
  it.each([
    ["me", "self"],
    ["friend", "friend"],
    ["blocked", "blocked"],
    ["asked", "incoming"],
    ["waiting", "outgoing"],
    ["stranger", "none"],
  ])("reads %s as %s", (userId, relation) => {
    expect(relationTo(userId, "me", social)).toBe(relation);
  });

  it("puts a block ahead of an old friendship or request", () => {
    const both = { ...social, blocked: [user("friend"), user("asked")] };

    expect(relationTo("friend", "me", both)).toBe("blocked");
    expect(relationTo("asked", "me", both)).toBe("blocked");
  });

  it("knows nobody as yourself before the session has a user", () => {
    expect(relationTo("stranger", undefined, social)).toBe("none");
  });
});
