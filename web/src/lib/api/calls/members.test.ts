import { describe, expect, it } from "vitest";

import {
  itAnswersMissingDeletes,
  itForwardsTheSignal,
  itSendsCalls,
  jsonResponse,
  mockFetch,
} from "@/test/http";

import { memberCalls } from "./members";

const fetchMock = mockFetch();
const calls = memberCalls();

const ROLE = { id: "r-1", name: "Mod", color: "#abc", permissions: ["manageMessages"] };
const USER = { id: "u-2", username: "ada", displayName: "Ada", presence: "online" };
const INVITE = { id: "i-1", url: "https://stellarr.test/join/x", createdByName: "Maja" };

describe("member calls", () => {
  itSendsCalls(fetchMock, [
    { name: "listRoles", run: () => calls.listRoles(), method: "GET", url: "/api/admin/roles", answer: [ROLE] },
    {
      name: "createRole",
      run: () => calls.createRole({ name: "Mod", color: "#abc", permissions: ["manageMessages"] }),
      method: "POST",
      url: "/api/admin/roles",
      body: { name: "Mod", color: "#abc", permissions: ["manageMessages"] },
      answer: ROLE,
    },
    {
      name: "updateRole",
      run: () => calls.updateRole("r/1", { name: "Mods" }),
      method: "PATCH",
      url: "/api/admin/roles/r%2F1",
      body: { name: "Mods" },
      answer: ROLE,
    },
    { name: "deleteRole", run: () => calls.deleteRole("r-1"), method: "DELETE", url: "/api/admin/roles/r-1" },
    {
      name: "listServerMembers",
      run: () => calls.listServerMembers(),
      method: "GET",
      url: "/api/admin/members",
      answer: [{ user: USER, roleId: "r-1", joinedAt: "2026-08-01T10:00:00Z" }],
    },
    {
      name: "assignRole",
      run: () => calls.assignRole("u-2", "r-1"),
      method: "PATCH",
      url: "/api/admin/members/u-2/role",
      body: { roleId: "r-1" },
    },
    { name: "kickMember", run: () => calls.kickMember("u-2"), method: "DELETE", url: "/api/admin/members/u-2" },
    {
      name: "listBans",
      run: () => calls.listBans(),
      method: "GET",
      url: "/api/admin/bans",
      answer: [
        {
          userId: "u-3",
          displayName: "Spam",
          bannedByName: "Maja",
          reason: "reklamy",
          bannedAt: "2026-08-15T10:00:00Z",
        },
      ],
    },
    {
      name: "banMember with a reason",
      run: () => calls.banMember("u-3", "spam"),
      method: "POST",
      url: "/api/admin/members/u-3/ban",
      body: { reason: "spam" },
    },
    {
      name: "banMember without a reason",
      run: () => calls.banMember("u-3"),
      method: "POST",
      url: "/api/admin/members/u-3/ban",
      body: { reason: null },
    },
    { name: "unbanMember", run: () => calls.unbanMember("u-3"), method: "DELETE", url: "/api/admin/bans/u-3" },
    { name: "listInvites", run: () => calls.listInvites(), method: "GET", url: "/api/admin/invites", answer: [INVITE] },
    { name: "createInvite", run: () => calls.createInvite(), method: "POST", url: "/api/admin/invites", answer: INVITE },
    { name: "revokeInvite", run: () => calls.revokeInvite("i-1"), method: "DELETE", url: "/api/admin/invites/i-1" },
    {
      name: "sendInvite",
      run: () => calls.sendInvite("i-1", "u-2"),
      method: "POST",
      url: "/api/admin/invites/i-1/members/u-2",
    },
  ]);

  describe("a target that is already gone", () => {
    itAnswersMissingDeletes(
      fetchMock,
      {
        deleteRole: () => calls.deleteRole("r-1"),
        unbanMember: () => calls.unbanMember("u-3"),
        revokeInvite: () => calls.revokeInvite("i-1"),
      },
      true,
    );
    itAnswersMissingDeletes(fetchMock, { kickMember: () => calls.kickMember("u-2") }, false);
  });

  itForwardsTheSignal(fetchMock, {
    kickMember: (signal) => calls.kickMember("u-2", signal),
    unbanMember: (signal) => calls.unbanMember("u-3", signal),
    revokeInvite: (signal) => calls.revokeInvite("i-1", signal),
    sendInvite: (signal) => calls.sendInvite("i-1", "u-2", signal),
  });

  it("reads the members with their user, role and join date", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ user: USER, roleId: "r-1", joinedAt: "2026-08-01T10:00:00Z" }]),
    );

    await expect(calls.listServerMembers()).resolves.toEqual([
      {
        user: expect.objectContaining({ id: "u-2", displayName: "Ada" }) as unknown,
        roleId: "r-1",
        joinedAt: "2026-08-01T10:00:00Z",
      },
    ]);
  });
});
