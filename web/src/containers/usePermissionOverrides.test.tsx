import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionOverride } from "@/ports";
import { fakeAdminPort } from "@/test/adminPort";
import { harness, resetHarness } from "@/test/modalsHarness";

import { usePermissionOverrides } from "./usePermissionOverrides";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const MODERATORS: PermissionOverride = { roleId: "role-mod", allow: ["manageMessages"], deny: [] };
const MEMBERS: PermissionOverride = { roleId: "role-member", allow: [], deny: ["manageMessages"] };

beforeEach(resetHarness);

describe("usePermissionOverrides", () => {
  it("reads nothing while no dialog is open", () => {
    renderHook(() => usePermissionOverrides("channel", null));

    expect(harness.ports.admin.listPermissionOverrides).not.toHaveBeenCalled();
  });

  it("reads the overrides of the channel or section the dialog is on", async () => {
    harness.ports.admin = fakeAdminPort({
      listPermissionOverrides: vi.fn(async () => [MODERATORS]),
    });

    const { result } = renderHook(() => usePermissionOverrides("section", "s-a"));

    await waitFor(() => expect(result.current.overrides).toEqual([MODERATORS]));
    expect(harness.ports.admin.listPermissionOverrides).toHaveBeenCalledExactlyOnceWith(
      "section",
      "s-a",
    );
  });

  it("starts empty when the target changes, and shows the new target's list", async () => {
    harness.ports.admin = fakeAdminPort({
      listPermissionOverrides: vi.fn(async (_type, id) => (id === "ch-a" ? [MODERATORS] : [MEMBERS])),
    });
    const { result, rerender } = renderHook(({ id }) => usePermissionOverrides("channel", id), {
      initialProps: { id: "ch-a" },
    });
    await waitFor(() => expect(result.current.overrides).toEqual([MODERATORS]));

    rerender({ id: "ch-b" });

    expect(result.current.overrides).toEqual([]);
    await waitFor(() => expect(result.current.overrides).toEqual([MEMBERS]));
  });

  it("leaves the list empty when it cannot be read", async () => {
    harness.ports.admin = fakeAdminPort({
      listPermissionOverrides: vi.fn(async () => {
        throw new Error("offline");
      }),
    });

    const { result } = renderHook(() => usePermissionOverrides("channel", "ch-a"));

    await waitFor(() => expect(harness.ports.admin.listPermissionOverrides).toHaveBeenCalled());
    expect(result.current.overrides).toEqual([]);
  });

  it("replaces a role's override with the one the server saved", async () => {
    const saved: PermissionOverride = { roleId: "role-mod", allow: [], deny: ["manageMessages"] };
    harness.ports.admin = fakeAdminPort({
      listPermissionOverrides: vi.fn(async () => [MODERATORS, MEMBERS]),
      setPermissionOverride: vi.fn(async () => saved),
    });
    const { result } = renderHook(() => usePermissionOverrides("channel", "ch-a"));
    await waitFor(() => expect(result.current.overrides).toHaveLength(2));

    await act(() => result.current.save("role-mod", { allow: [], deny: ["manageMessages"] }));

    expect(harness.ports.admin.setPermissionOverride).toHaveBeenCalledExactlyOnceWith(
      "channel",
      "ch-a",
      "role-mod",
      { allow: [], deny: ["manageMessages"] },
    );
    expect(result.current.overrides).toEqual([MEMBERS, saved]);
  });

  it("drops an override that allows and denies nothing", async () => {
    harness.ports.admin = fakeAdminPort({
      listPermissionOverrides: vi.fn(async () => [MODERATORS, MEMBERS]),
      setPermissionOverride: vi.fn(async (_type, _id, roleId) => ({ roleId, allow: [], deny: [] })),
    });
    const { result } = renderHook(() => usePermissionOverrides("channel", "ch-a"));
    await waitFor(() => expect(result.current.overrides).toHaveLength(2));

    await act(() => result.current.save("role-mod", { allow: [], deny: [] }));

    expect(result.current.overrides).toEqual([MEMBERS]);
  });

  it("keeps the list as it was when the save is refused", async () => {
    harness.ports.admin = fakeAdminPort({
      listPermissionOverrides: vi.fn(async () => [MODERATORS]),
      setPermissionOverride: vi.fn(async () => {
        throw new Error("forbidden");
      }),
    });
    const { result } = renderHook(() => usePermissionOverrides("channel", "ch-a"));
    await waitFor(() => expect(result.current.overrides).toEqual([MODERATORS]));

    await expect(result.current.save("role-mod", { allow: [], deny: [] })).rejects.toThrow("forbidden");

    expect(result.current.overrides).toEqual([MODERATORS]);
  });
});
