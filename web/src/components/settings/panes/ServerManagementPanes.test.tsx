import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/ports";

import { ChannelsPane } from "./ChannelsPane";
import { DangerPane } from "./DangerPane";
import { InvitesPane } from "./InvitesPane";
import { MembersPane } from "./MembersPane";
import { RolesPane } from "./RolesPane";

const role: Role = {
  id: "role-member",
  name: "Ekipa",
  color: "#8b7cf6",
  permissions: [],
  memberCount: 1,
  isSystem: false,
  isOwner: false,
};

describe("server management panes", () => {
  it("puts channels in the shared section without changing its actions", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    render(
      <ChannelsPane
        supported
        channels={[{ id: "general", name: "ogólny", kind: "text" }]}
        onAdd={onAdd}
        onEdit={onEdit}
        sectionsSupported
        sections={[]}
        onAddSection={vi.fn()}
        onEditSection={vi.fn()}
        onMoveSectionUp={vi.fn()}
        onMoveSectionDown={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "Kanały serwera" }))
      .toHaveClass("settings-section");
    await user.click(screen.getByRole("button", { name: "Dodaj kanał" }));
    await user.click(screen.getByRole("button", { name: "Edytuj kanał ogólny" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith("general");
  });

  it("puts roles and their editor in shared sections", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <RolesPane
        supported
        roles={[role]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nowa rola" }));
    expect(onCreate).toHaveBeenCalledWith({
      name: "Nowa rola",
      color: "#8b7cf6",
      permissions: [],
    });
    await user.click(screen.getByRole("button", { name: "Uprawnienia roli Ekipa" }));
    expect(screen.getByRole("region", { name: "Uprawnienia: Ekipa" })).toBeVisible();
  });

  it("keeps member role assignment inside the people section", async () => {
    const user = userEvent.setup();
    const onAssignRole = vi.fn().mockResolvedValue(undefined);
    render(
      <MembersPane
        supported
        roles={[role]}
        members={[
          {
            user: {
              id: "u-1",
              username: "maja",
              displayName: "Maja",
              presence: "online",
            },
            roleId: role.id,
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        onAssignRole={onAssignRole}
      />,
    );

    expect(screen.getByRole("region", { name: "Osoby na serwerze" })).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "Rola osoby Maja" }), role.id);
    expect(onAssignRole).toHaveBeenCalledWith("u-1", role.id);
  });

  it("keeps invite creation and revocation in the shared section", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onRevoke = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <InvitesPane
        supported
        invites={[
          {
            id: "invite-1",
            url: "https://stellarr.test/i/abc",
            createdByName: "Maja",
            uses: 0,
            maxUses: null,
            expiresAt: null,
          },
        ]}
        onCreate={onCreate}
        onRevoke={onRevoke}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nowy link" }));
    await user.click(screen.getByRole("button", {
      name: "Kopiuj zaproszenie https://stellarr.test/i/abc",
    }));
    expect(writeText).toHaveBeenCalledWith("https://stellarr.test/i/abc");
    expect(screen.getByRole("button", {
      name: "Kopiuj zaproszenie https://stellarr.test/i/abc",
    })).toHaveTextContent("Skopiowano");
    await user.click(screen.getByRole("button", {
      name: "Unieważnij zaproszenie https://stellarr.test/i/abc",
    }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onRevoke).toHaveBeenCalledWith("invite-1");
  });

  it("keeps both owner actions inside the danger section", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    const onDelete = vi.fn();
    render(
      <DangerPane
        supported
        serverName="Orbit"
        onTransfer={onTransfer}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole("region", { name: "Strefa zagrożenia" }))
      .toHaveClass("danger-section");
    await user.click(screen.getByRole("button", { name: "Przekaż" }));
    await user.click(screen.getByRole("button", { name: "Usuń Orbit" }));
    expect(onTransfer).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
