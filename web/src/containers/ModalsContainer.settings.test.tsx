import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import type { AdminMember, Invite, Role } from "@/ports";
import { fakeAdminPort } from "@/test/adminPort";
import { harness, resetHarness } from "@/test/modalsHarness";

import { ModalsContainer } from "./ModalsContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translateMessage("pl", key, values);

const MEMBER_ROLE: Role = {
  id: "role-member",
  name: "Member",
  color: "#8b7cf6",
  permissions: [],
  memberCount: 2,
  isSystem: false,
  isOwner: false,
};

const OWNER_ROLE: Role = {
  ...MEMBER_ROLE,
  id: "role-owner",
  name: "Owner",
  isSystem: true,
  isOwner: true,
};

const MAJA: AdminMember = {
  user: { id: "u-maja", username: "maja", displayName: "Maja Kowalska", presence: "online" },
  roleId: OWNER_ROLE.id,
  joinedAt: "2026-01-01T00:00:00.000Z",
};

const OLA: AdminMember = {
  user: { id: "u-ola", username: "ola", displayName: "Ola", presence: "idle" },
  roleId: MEMBER_ROLE.id,
  joinedAt: "2026-01-02T00:00:00.000Z",
};

const created: Invite = {
  id: "inv-1",
  url: "https://chat.example/invite/fresh",
  createdByName: "Maja",
  uses: 0,
  maxUses: null,
  expiresAt: null,
};

function openSettings(pane?: MessageKey) {
  harness.ui.modal = "settings";
  render(<ModalsContainer />);
  return pane === undefined
    ? Promise.resolve()
    : userEvent.setup().click(screen.getByRole("button", { name: t(pane) }));
}

beforeEach(resetHarness);
afterEach(() => vi.restoreAllMocks());

describe("ModalsContainer: server settings", () => {
  it("stays shut for somebody who may not manage anything on the server", () => {
    harness.directory.canAccessServerSettings = false;

    openSettings();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(harness.ports.admin.listRoles).not.toHaveBeenCalled();
  });

  it("shows the roles it fetched and refetches them after a role is edited", async () => {
    const user = userEvent.setup();
    const listRoles = vi
      .fn<() => Promise<Role[]>>()
      .mockResolvedValueOnce([MEMBER_ROLE])
      .mockResolvedValueOnce([{ ...MEMBER_ROLE, name: "Regular" }]);
    harness.ports.admin = fakeAdminPort({ listRoles, updateRole: vi.fn(async () => MEMBER_ROLE) });
    await openSettings("server.roles");

    await user.click(
      await screen.findByRole("button", { name: t("settings.rolePermissionsLabel", { name: "Member" }) }),
    );
    const name = screen.getByLabelText(t("settings.roleName"));
    await user.clear(name);
    await user.type(name, "Regular");
    await user.click(screen.getByRole("button", { name: t("settings.save") }));

    expect(harness.ports.admin.updateRole).toHaveBeenCalledExactlyOnceWith("role-member", {
      name: "Regular",
      color: "#8b7cf6",
      permissions: [],
    });
    expect(await screen.findByText("Regular", { selector: ".role-name" })).toBeVisible();
    expect(listRoles).toHaveBeenCalledTimes(2);
  });

  it("neither refetches nor changes the list when a role edit is refused", async () => {
    const user = userEvent.setup();
    const listRoles = vi.fn(async () => [MEMBER_ROLE]);
    harness.ports.admin = fakeAdminPort({
      listRoles,
      updateRole: vi.fn(async () => {
        throw new ApiError("forbidden", "no", 403);
      }),
    });
    await openSettings("server.roles");

    await user.click(
      await screen.findByRole("button", { name: t("settings.rolePermissionsLabel", { name: "Member" }) }),
    );
    await user.type(screen.getByLabelText(t("settings.roleName")), " 2");
    await user.click(screen.getByRole("button", { name: t("settings.save") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("settings.roleActionFailed"));
    expect(listRoles).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Member", { selector: ".role-name" })).toBeVisible();
  });

  it("frees the pane as soon as the mutation lands, not when the lists are back", async () => {
    const user = userEvent.setup();
    const listInvites = vi
      .fn<() => Promise<Invite[]>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise(() => {}));
    harness.ports.admin = fakeAdminPort({
      listInvites,
      createInvite: vi.fn(async () => created),
    });
    await openSettings("server.invites");

    const create = await screen.findByRole("button", { name: t("settings.newInvite") });
    await user.click(create);

    await waitFor(() => expect(listInvites).toHaveBeenCalledTimes(2));
    expect(harness.ports.admin.createInvite).toHaveBeenCalledOnce();
    await waitFor(() => expect(create).toBeEnabled());
  });

  it("shows a created invite once the list has been refetched", async () => {
    const user = userEvent.setup();
    let invites: Invite[] = [];
    harness.ports.admin = fakeAdminPort({
      listInvites: vi.fn(async () => invites),
      createInvite: vi.fn(async () => {
        invites = [created];
        return created;
      }),
    });
    await openSettings("server.invites");

    await user.click(await screen.findByRole("button", { name: t("settings.newInvite") }));

    expect(await screen.findByText(created.url)).toBeVisible();
  });

  it("moves a section by swapping it with its neighbour", async () => {
    const user = userEvent.setup();
    harness.directory.sections = [
      { id: "s-a", name: "Alpha" },
      { id: "s-b", name: "Beta" },
      { id: "s-c", name: "Gamma" },
    ];
    await openSettings("server.channels");

    await user.click(screen.getByRole("button", { name: t("section.moveUpNamed", { name: "Beta" }) }));
    await user.click(screen.getByRole("button", { name: t("section.moveDownNamed", { name: "Beta" }) }));

    expect(harness.ports.directory.reorderSections).toHaveBeenNthCalledWith(1, ["s-b", "s-a", "s-c"]);
    expect(harness.ports.directory.reorderSections).toHaveBeenNthCalledWith(2, ["s-a", "s-c", "s-b"]);
  });

  describe("transferring ownership", () => {
    beforeEach(() => {
      harness.ports.admin = fakeAdminPort({
        listMembers: vi.fn(async () => [MAJA, OLA]),
        listRoles: vi.fn(async () => [OWNER_ROLE, MEMBER_ROLE]),
      });
    });

    async function transferTo(answer: string | null) {
      vi.spyOn(window, "prompt").mockReturnValue(answer);
      await openSettings("server.danger");
      const dialog = await screen.findByRole("dialog");
      await userEvent.setup().click(
        await within(dialog).findByRole("button", { name: t("settings.transfer") }),
      );
    }

    it("matches the answer to a member by username or display name and reloads", async () => {
      await transferTo(" OLA ");

      expect(harness.ports.admin.transferOwnership).toHaveBeenCalledExactlyOnceWith("u-ola");
      expect(harness.ports.admin.listMembers).toHaveBeenCalledTimes(2);
    });

    it.each([["nobody by that name"], [null]])("does nothing for %s", async (answer) => {
      await transferTo(answer);

      expect(harness.ports.admin.transferOwnership).not.toHaveBeenCalled();
    });
  });

  it("deletes the server only when its exact name is typed", async () => {
    const user = userEvent.setup();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("orbit");
    await openSettings("server.danger");

    await user.click(
      await screen.findByRole("button", { name: t("settings.deleteNamedServer", { name: "Orbit" }) }),
    );

    expect(prompt).toHaveBeenCalledOnce();
    expect(harness.ports.admin.deleteServer).not.toHaveBeenCalled();
  });
});
