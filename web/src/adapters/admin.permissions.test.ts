import { describe, expect, it, vi } from "vitest";

import type { AdminApiClient } from "@/lib/api/client";
import type { Channel, Section, ServerPermission } from "@/lib/api/types";

import { createServerAdminAdapter } from "./admin";

function build(
  api: Partial<AdminApiClient>,
  permissions: () => readonly ServerPermission[] = () => [],
) {
  const callbacks = {
    onServerIconChanged: vi.fn(),
    onChannelChanged: vi.fn(),
    onServerChanged: vi.fn(),
    onChannelCreated: vi.fn(),
    onChannelDeleted: vi.fn(),
    onSectionCreated: vi.fn(),
    onSectionChanged: vi.fn(),
    onSectionDeleted: vi.fn(),
  };
  const adapter = createServerAdminAdapter(
    api as AdminApiClient,
    permissions,
    callbacks.onServerIconChanged,
    callbacks.onChannelChanged,
    callbacks.onServerChanged,
    callbacks.onChannelCreated,
    callbacks.onChannelDeleted,
    callbacks.onSectionCreated,
    callbacks.onSectionChanged,
    callbacks.onSectionDeleted,
  );
  return { adapter, ...callbacks };
}

describe("server admin adapter permissions", () => {
  it("offers nothing to a member without permissions", () => {
    const { adapter } = build({});

    expect(Object.values(adapter.supported).some(Boolean)).toBe(false);
  });

  it("maps each permission onto the panes it unlocks", () => {
    const supported = (...permissions: ServerPermission[]) =>
      build({}, () => permissions).adapter.supported;

    expect(supported("manageServer")).toMatchObject({
      server: true,
      serverIcon: true,
      invites: true,
      emoji: true,
      soundboard: true,
      channels: false,
    });
    expect(supported("manageChannels")).toMatchObject({ channels: true, sections: true });
    expect(supported("manageRoles").roles).toBe(true);
    expect(supported("manageMembers").members).toBe(true);
    expect(supported("viewAuditLog").audit).toBe(true);
    expect(supported("moderateMembers")).toMatchObject({ moderation: true, bans: false });
    expect(supported("manageBans")).toMatchObject({ moderation: true, bans: true });
  });

  it("follows permission changes without being rebuilt", () => {
    let permissions: readonly ServerPermission[] = [];
    const { adapter } = build({}, () => permissions);
    expect(adapter.supported.roles).toBe(false);

    permissions = ["manageRoles"];
    expect(adapter.supported.roles).toBe(true);
  });

  it("returns an empty ban list without asking the API when bans are not manageable", async () => {
    const listBans = vi.fn(async () => [
      { user: { id: "u-1", username: "a", displayName: "A", presence: "online" as const } },
    ]);
    let permissions: readonly ServerPermission[] = ["moderateMembers"];
    const { adapter } = build({ listBans } as unknown as Partial<AdminApiClient>, () => permissions);

    await expect(adapter.listBans()).resolves.toEqual([]);
    expect(listBans).not.toHaveBeenCalled();

    permissions = ["manageBans"];
    await expect(adapter.listBans()).resolves.toHaveLength(1);
  });
});

describe("server admin adapter change callbacks", () => {
  it("reports the new icon, and its removal, to the directory", async () => {
    const { adapter, onServerIconChanged } = build({
      uploadServerIcon: vi.fn(async () => "/icons/new.png"),
      removeServerIcon: vi.fn(async () => {}),
    });

    await expect(adapter.uploadServerIcon(new File(["x"], "icon.png"))).resolves.toBe(
      "/icons/new.png",
    );
    expect(onServerIconChanged).toHaveBeenLastCalledWith("/icons/new.png");

    await adapter.removeServerIcon();
    expect(onServerIconChanged).toHaveBeenLastCalledWith(undefined);
  });

  it("reports channel creation, update and deletion with the server's answer", async () => {
    const created: Channel = { id: "ch-new", name: "nowy", kind: "text" };
    const updated: Channel = { ...created, topic: "Temat" };
    const { adapter, onChannelCreated, onChannelChanged, onChannelDeleted } = build({
      createChannel: vi.fn(async () => created),
      updateChannel: vi.fn(async () => updated),
      deleteChannel: vi.fn(async () => {}),
    });

    await adapter.createChannel({ name: "nowy", kind: "text" });
    expect(onChannelCreated).toHaveBeenCalledWith(created);

    await adapter.updateChannel("ch-new", { topic: "Temat" });
    expect(onChannelChanged).toHaveBeenCalledWith("ch-new", updated);

    await adapter.deleteChannel("ch-new");
    expect(onChannelDeleted).toHaveBeenCalledWith("ch-new");
  });

  it("clears a channel's section locally when it is moved out of one", async () => {
    const assignChannelSection = vi.fn(async () => {});
    const { adapter, onChannelChanged } = build({ assignChannelSection });

    await adapter.assignChannelSection("ch-1", "sec-1");
    expect(onChannelChanged).toHaveBeenLastCalledWith("ch-1", { sectionId: "sec-1" });

    await adapter.assignChannelSection("ch-1", null);
    expect(assignChannelSection).toHaveBeenLastCalledWith("ch-1", null);
    expect(onChannelChanged).toHaveBeenLastCalledWith("ch-1", { sectionId: undefined });
  });

  it("reports section creation, rename and deletion", async () => {
    const section: Section = { id: "sec-1", name: "Gry", position: 0 };
    const renamed = { ...section, name: "Planszówki" };
    const { adapter, onSectionCreated, onSectionChanged, onSectionDeleted } = build({
      createSection: vi.fn(async () => section),
      updateSection: vi.fn(async () => renamed),
      deleteSection: vi.fn(async () => {}),
    });

    await adapter.createSection({ name: "Gry" });
    expect(onSectionCreated).toHaveBeenCalledWith(section);

    await adapter.updateSection("sec-1", { name: "Planszówki" });
    expect(onSectionChanged).toHaveBeenCalledWith(renamed);

    await adapter.deleteSection("sec-1");
    expect(onSectionDeleted).toHaveBeenCalledWith("sec-1");
  });

  it("does not report a deletion that the server rejected", async () => {
    const { adapter, onChannelDeleted } = build({
      deleteChannel: vi.fn(async () => {
        throw new Error("forbidden");
      }),
    });

    await expect(adapter.deleteChannel("ch-1")).rejects.toThrow("forbidden");
    expect(onChannelDeleted).not.toHaveBeenCalled();
  });

  it("still sends every request when the optional callbacks are not wired", async () => {
    const api = {
      updateServer: vi.fn(async () => ({ id: "s-1", name: "Orbita" })),
      createChannel: vi.fn(async () => ({ id: "c", name: "c", kind: "text" as const })),
      updateChannel: vi.fn(async () => ({ id: "c", name: "d", kind: "text" as const })),
      createSection: vi.fn(async () => ({ id: "sec", name: "s" })),
      updateSection: vi.fn(async () => ({ id: "sec", name: "t" })),
    };
    const adapter = createServerAdminAdapter(
      api as unknown as AdminApiClient,
      () => [],
      vi.fn(),
    );

    await expect(adapter.updateServer({ name: "Orbita" })).resolves.toBeUndefined();
    await expect(adapter.createChannel({ name: "c", kind: "text" })).resolves.toBeUndefined();
    await expect(adapter.updateChannel("c", { name: "d" })).resolves.toBeUndefined();
    await expect(adapter.createSection({ name: "s" })).resolves.toBeUndefined();
    await expect(adapter.updateSection("sec", { name: "t" })).resolves.toBeUndefined();

    expect(api.updateServer).toHaveBeenCalledWith({ name: "Orbita" });
    expect(api.createChannel).toHaveBeenCalledWith({ name: "c", kind: "text" });
    expect(api.updateChannel).toHaveBeenCalledWith("c", { name: "d" });
    expect(api.createSection).toHaveBeenCalledWith({ name: "s" });
    expect(api.updateSection).toHaveBeenCalledWith("sec", { name: "t" });
  });

  it("forwards moderation and ownership calls as given", async () => {
    const api = {
      kickMember: vi.fn(async () => {}),
      kickVoiceMember: vi.fn(async () => {}),
      moveVoiceMember: vi.fn(async () => {}),
      banMember: vi.fn(async () => {}),
      unbanMember: vi.fn(async () => {}),
      transferServer: vi.fn(async () => {}),
      setNotificationSettings: vi.fn(async () => ({})),
    };
    const { adapter } = build(api as unknown as Partial<AdminApiClient>);

    await adapter.kick("u-1");
    await adapter.kickFromChannel?.("ch-1", "u-1");
    await adapter.moveVoiceMember?.("ch-1", "ch-2", "u-1");
    await adapter.ban("u-1", "spam");
    await adapter.unban("u-1");
    await adapter.transferOwnership("u-2");
    await expect(adapter.setNotificationSettings({ serverMuted: true })).resolves.toBeUndefined();

    expect(api.kickMember).toHaveBeenCalledWith("u-1");
    expect(api.kickVoiceMember).toHaveBeenCalledWith("ch-1", "u-1");
    expect(api.moveVoiceMember).toHaveBeenCalledWith("ch-1", "ch-2", "u-1");
    expect(api.banMember).toHaveBeenCalledWith("u-1", "spam");
    expect(api.unbanMember).toHaveBeenCalledWith("u-1");
    expect(api.transferServer).toHaveBeenCalledWith("u-2");
    expect(api.setNotificationSettings).toHaveBeenCalledWith({ serverMuted: true });
  });
});
