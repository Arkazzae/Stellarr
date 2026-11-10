import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Invite, Role } from "@/ports";
import { NONE_SUPPORTED, fakeAdminPort } from "@/test/adminPort";
import { harness, resetHarness } from "@/test/modalsHarness";

import { useServerAdmin } from "./useServerAdmin";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const ROLE: Role = {
  id: "role-member",
  name: "Member",
  color: "#8b7cf6",
  permissions: [],
  memberCount: 3,
  isSystem: true,
  isOwner: false,
};

const INVITE: Invite = {
  id: "inv-1",
  url: "https://chat.example/invite/abc",
  createdByName: "Maja",
  uses: 0,
  maxUses: null,
  expiresAt: null,
};

function listCalls() {
  const { admin } = harness.ports;
  return {
    roles: vi.mocked(admin.listRoles).mock.calls.length,
    members: vi.mocked(admin.listMembers).mock.calls.length,
    invites: vi.mocked(admin.listInvites).mock.calls.length,
    bans: vi.mocked(admin.listBans).mock.calls.length,
    audit: vi.mocked(admin.listAuditEntries).mock.calls.length,
  };
}

beforeEach(resetHarness);

describe("useServerAdmin", () => {
  it("reads nothing until a dialog needs the lists, then each list once", async () => {
    harness.ports.admin = fakeAdminPort({ listRoles: vi.fn(async () => [ROLE]) });
    const { result, rerender } = renderHook(({ wanted }) => useServerAdmin(wanted), {
      initialProps: { wanted: false },
    });

    expect(listCalls()).toEqual({ roles: 0, members: 0, invites: 0, bans: 0, audit: 0 });

    rerender({ wanted: true });
    await waitFor(() => expect(result.current.data.roles).toEqual([ROLE]));
    rerender({ wanted: true });

    expect(listCalls()).toEqual({ roles: 1, members: 1, invites: 1, bans: 1, audit: 1 });
  });

  it("asks only for the lists the server supports", async () => {
    harness.ports.admin = fakeAdminPort({
      supported: { ...NONE_SUPPORTED, invites: true, audit: true },
      listInvites: vi.fn(async () => [INVITE]),
    });
    const { result } = renderHook(() => useServerAdmin(true));

    await waitFor(() => expect(result.current.data.invites).toEqual([INVITE]));

    expect(listCalls()).toEqual({ roles: 0, members: 0, invites: 1, bans: 0, audit: 1 });
  });

  it.each([
    ["members", { members: true }, { roles: 1, members: 1 }],
    ["the server profile", { server: true }, { roles: 1, members: 1 }],
    ["roles", { roles: true }, { roles: 1, members: 0 }],
  ])("reads the roles for %s, and members only where they are shown", (_pane, support, expected) => {
    harness.ports.admin = fakeAdminPort({ supported: { ...NONE_SUPPORTED, ...support } });

    renderHook(() => useServerAdmin(true));

    expect(listCalls()).toEqual({ invites: 0, bans: 0, audit: 0, ...expected });
  });

  it("drops lists that arrive after the dialog has closed", async () => {
    let deliver: (roles: Role[]) => void = () => {};
    harness.ports.admin = fakeAdminPort({
      listRoles: vi.fn(() => new Promise<Role[]>((resolve) => (deliver = resolve))),
    });
    const { result, rerender } = renderHook(({ wanted }) => useServerAdmin(wanted), {
      initialProps: { wanted: true },
    });

    rerender({ wanted: false });
    await act(async () => deliver([ROLE]));

    expect(result.current.data.roles).toEqual([]);
  });

  it("keeps the lists it has when a refresh fails", async () => {
    const listRoles = vi
      .fn<() => Promise<Role[]>>()
      .mockResolvedValueOnce([ROLE])
      .mockRejectedValueOnce(new Error("offline"));
    harness.ports.admin = fakeAdminPort({ listRoles });
    const { result } = renderHook(() => useServerAdmin(true));
    await waitFor(() => expect(result.current.data.roles).toEqual([ROLE]));

    act(() => result.current.reload());
    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(2));
    await act(async () => {});

    expect(result.current.data.roles).toEqual([ROLE]);
  });

  it("puts the new lists in place once a reload lands, without making the caller wait", async () => {
    let deliver: (invites: Invite[]) => void = () => {};
    harness.ports.admin = fakeAdminPort({
      listInvites: vi.fn(() => new Promise<Invite[]>((resolve) => (deliver = resolve))),
    });
    const { result } = renderHook(() => useServerAdmin(false));

    const returned: unknown = result.current.reload();

    expect(returned).toBeUndefined();
    expect(result.current.data.invites).toEqual([]);
    await act(async () => deliver([INVITE]));
    expect(result.current.data.invites).toEqual([INVITE]);
  });
});
