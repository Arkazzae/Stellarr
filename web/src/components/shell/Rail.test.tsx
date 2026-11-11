import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";
import type { PersonVM, VoiceChannelVM } from "@/components/view-models";

import { Rail, type RailProps, voiceMoveRequest } from "./Rail";

function person(overrides: Partial<PersonVM> & { id: string }): PersonVM {
  return {
    displayName: overrides.id,
    initials: overrides.id.slice(0, 2).toUpperCase(),
    presence: "online",
    ...overrides,
  };
}

function setup(occupants: PersonVM[], overrides: Partial<RailProps> = {}) {
  const channel: VoiceChannelVM = {
    id: "v-1",
    name: "Ogólny",
    occupants,
  };

  const props: RailProps = {
    serverName: "Orbit",
    textChannels: [],
    voiceChannels: [channel],
    activeChannelId: "v-1",
    selfId: "me",
    onSelectTextChannel: vi.fn(),
    onJoinVoiceChannel: vi.fn(),
    onEditServer: vi.fn(),
    onInvite: vi.fn(),
    onReorderChannelGroup: vi.fn(),
    ...overrides,
  };

  render(
    <ConfirmProvider>
      <Rail {...props} />
    </ConfirmProvider>,
  );
  return props;
}

/** The occupant row for one person, found by the name it prints. */
function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest("li");
  if (item === null) throw new Error(`No occupant row for ${name}`);
  return item;
}

describe("Rail voice occupants", () => {
  it("says out loud who is muted, yourself included", () => {
    setup([
      person({ id: "me", displayName: "Maja", muted: true }),
      person({ id: "u-2", displayName: "Jo", speaking: true }),
    ]);

    // Muting yourself has to be visible somewhere other than the button you
    // pressed, and this list is where you see who is on the call.
    expect(within(row("Maja")).getByText("Wyciszony")).toBeInTheDocument();
    expect(row("Maja").className).toContain("muted");

    expect(within(row("Jo")).getByText("Mówi")).toBeInTheDocument();
    expect(row("Jo").className).not.toContain("muted");
  });

  it("leaves an unmuted, quiet occupant plain", () => {
    setup([person({ id: "u-3", displayName: "Kris" })]);

    expect(within(row("Kris")).getByText("Cisza")).toBeInTheDocument();
    expect(row("Kris").className || "").not.toContain("muted");
  });

  it("offers voice and server moderation from an occupant right-click", async () => {
    const user = userEvent.setup();
    const onKickFromChannel = vi.fn();
    setup([person({ id: "u-2", displayName: "Jo" })], {
      voiceMemberMenu: {
        canKick: true,
        canBan: true,
        canKickFromChannel: () => true,
        onKickFromChannel,
        onKick: vi.fn(),
        onBan: vi.fn(),
      },
    });

    fireEvent.contextMenu(row("Jo"), { clientX: 40, clientY: 120 });

    const menu = screen.getByRole("menu", { name: "Jo" });
    expect(within(menu).getByRole("menuitem", { name: "Wyrzuć z kanału" }))
      .toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Wyrzuć z serwera" }))
      .toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Zbanuj" }))
      .toBeInTheDocument();

    await user.click(
      within(menu).getByRole("menuitem", { name: "Wyrzuć z kanału" }),
    );
    await user.click(screen.getByRole("button", { name: "Rozłącz" }));
    expect(onKickFromChannel).toHaveBeenCalledWith("u-2");
  });

  it("exposes another occupant as a keyboard draggable and maps its drop", () => {
    const onMoveVoiceMember = vi.fn(async () => {});
    const jo = person({ id: "u-2", displayName: "Jo" });
    setup([], {
      voiceChannels: [
        {
          id: "v-1",
          name: "Ogólny",
          occupants: [jo],
        },
        { id: "v-2", name: "Nocna zmiana", occupants: [] },
      ],
      onMoveVoiceMember,
    });

    const occupant = row("Jo");
    expect(occupant).toHaveAttribute("role", "button");
    expect(occupant).toHaveAttribute(
      "aria-label",
      "Jo, przenieś do innego kanału głosowego",
    );
    expect(occupant.querySelector(".occ-drag")).toBeNull();
    expect(
      voiceMoveRequest(
        { type: "voice-occupant", person: jo, sourceChannelId: "v-1" },
        { type: "voice-channel", channelId: "v-2" },
      ),
    ).toEqual({
      userId: "u-2",
      displayName: "Jo",
      sourceChannelId: "v-1",
      targetChannelId: "v-2",
    });
  });

  it("does not expose the administrator's own voice row as draggable", () => {
    setup([person({ id: "me", displayName: "Maja" })], {
      onMoveVoiceMember: vi.fn(async () => {}),
    });

    expect(row("Maja")).not.toHaveAttribute("role", "button");
    expect(row("Maja")).not.toHaveClass("is-draggable");
  });
});

describe("Rail server administration", () => {
  it("hides server management from a regular member", () => {
    setup([]);

    expect(screen.queryByRole("button", { name: "Edytuj serwer" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Zaproś na serwer" }),
    ).toBeNull();
  });

  it("shows server management to a member with permission", () => {
    setup([], { canAccessServerSettings: true, canManageServer: true });

    expect(
      screen.getByRole("button", { name: "Edytuj serwer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zaproś na serwer" }),
    ).toBeInTheDocument();
  });

  it("shows settings but not invites to a delegated manager", () => {
    setup([], { canAccessServerSettings: true, canManageServer: false });

    expect(
      screen.getByRole("button", { name: "Edytuj serwer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zaproś na serwer" }),
    ).toBeNull();
  });
});

describe("Rail channel threads", () => {
  const texts = [
    { id: "t-1", name: "ogólny", kind: "text" as const, unread: 0 },
    { id: "t-2", name: "bez-wątków", kind: "text" as const, unread: 0 },
  ];
  const thread = {
    id: "root-1",
    channelId: "t-1",
    authorName: "Maja",
    preview: "Plan wyprawy na orbitę",
    replyCount: 2,
  };

  it("shows a dropdown only on channels that have threads", async () => {
    const user = userEvent.setup();
    const onOpenThread = vi.fn();
    setup([], {
      textChannels: texts,
      threadsByChannel: { "t-1": [thread] },
      activeChannelId: "t-1",
      onOpenThread,
    });

    expect(
      screen.queryByRole("button", { name: "Pokaż wątki kanału bez-wątków" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Pokaż wątki kanału ogólny" }),
    );

    const list = screen.getByRole("list", { name: "Wątki kanału ogólny" });
    const row = within(list).getByRole("button", {
      name: "Otwórz wątek „Plan wyprawy na orbitę”, Maja, 2 odpowiedzi",
    });
    expect(row).not.toHaveAttribute("aria-current");

    await user.click(row);
    expect(onOpenThread).toHaveBeenCalledWith(thread);
  });

  it("moves selection and focus from the parent channel to its active thread", async () => {
    const user = userEvent.setup();
    const onSelectTextChannel = vi.fn();
    setup([], {
      textChannels: texts,
      threadsByChannel: { "t-1": [thread] },
      activeChannelId: "t-1",
      activeThreadId: thread.id,
      onSelectTextChannel,
    });

    const parent = screen.getByText("ogólny").closest(".channel");
    const list = screen.getByRole("list", { name: "Wątki kanału ogólny" });
    const activeThread = within(list).getByRole("button", {
      name: "Otwórz wątek „Plan wyprawy na orbitę”, Maja, 2 odpowiedzi",
    });

    expect(parent).not.toHaveAttribute("aria-current");
    expect(activeThread).toHaveAttribute("aria-current", "page");
    expect(activeThread).toHaveFocus();

    await user.click(
      within(parent as HTMLElement).getByRole("button", { name: "ogólny" }),
    );
    expect(onSelectTextChannel).toHaveBeenCalledWith("t-1");
  });
});

/** Right-click the row that prints this name. */
function rightClick(name: string): void {
  const target = screen.getByText(name).closest("[role='button'], button");
  if (target === null) throw new Error(`No channel row for ${name}`);
  fireEvent.contextMenu(target, { clientX: 40, clientY: 120 });
}

describe("Rail channel menu", () => {
  const texts = [
    { id: "t-1", name: "ogólny", kind: "text" as const, unread: 3 },
    { id: "t-2", name: "cisza", kind: "text" as const, unread: 0 },
  ];

  it("leaves the browser's own menu alone when there is nothing to offer", () => {
    setup([], { textChannels: texts });

    rightClick("ogólny");

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers what the channel can do, named after the channel", () => {
    setup([], {
      textChannels: texts,
      channelMenu: { onMarkRead: vi.fn(), onInvite: vi.fn() },
    });

    rightClick("ogólny");

    const menu = screen.getByRole("menu", { name: "Kanał ogólny" });
    expect(within(menu).getByRole("menuitem", { name: "Oznacz jako przeczytane" }))
      .toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Zaproś znajomych" }))
      .toBeInTheDocument();
    // Not a manager: the channel's own dialog is not on offer.
    expect(within(menu).queryByRole("menuitem", { name: "Ustawienia kanału" }))
      .toBeNull();
  });

  it("drops the read item on a channel that is already read", () => {
    setup([], {
      textChannels: texts,
      channelMenu: { onMarkRead: vi.fn(), onInvite: vi.fn() },
    });

    rightClick("cisza");

    expect(
      screen.queryByRole("menuitem", { name: "Oznacz jako przeczytane" }),
    ).toBeNull();
  });

  it("clears the badge of the channel it was raised on", async () => {
    const user = userEvent.setup();
    const onMarkRead = vi.fn();
    setup([], { textChannels: texts, channelMenu: { onMarkRead } });

    rightClick("ogólny");
    await user.click(
      screen.getByRole("menuitem", { name: "Oznacz jako przeczytane" }),
    );

    expect(onMarkRead).toHaveBeenCalledWith("t-1");
  });

  it("mutes and unmutes text-channel notifications from the right-click menu", async () => {
    const user = userEvent.setup();
    const onSetMuted = vi.fn();
    setup([], {
      textChannels: texts,
      channelMenu: {
        isMuted: () => false,
        onSetMuted,
      },
    });

    rightClick("cisza");
    await user.click(
      screen.getByRole("menuitem", {
        name: "Wycisz powiadomienia kanału",
      }),
    );
    expect(onSetMuted).toHaveBeenCalledWith("t-2", true);
  });

  it("opens member settings for text notifications, but not for voice channels", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    setup([], {
      textChannels: texts,
      channelMenu: {
        onOpenSettings,
        canOpenSettings: (_channelId, kind) => kind === "text",
      },
    });

    rightClick("cisza");
    await user.click(
      screen.getByRole("menuitem", { name: "Ustawienia kanału" }),
    );
    expect(onOpenSettings).toHaveBeenCalledWith("t-2");

    rightClick("Ogólny");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows and removes an existing notification mute", async () => {
    const user = userEvent.setup();
    const onSetMuted = vi.fn();
    setup([], {
      textChannels: texts,
      channelMenu: { isMuted: () => true, onSetMuted },
    });

    expect(screen.getAllByTitle("Powiadomienia wyciszone")).not.toHaveLength(0);
    rightClick("cisza");
    await user.click(
      screen.getByRole("menuitem", {
        name: "Włącz powiadomienia kanału",
      }),
    );
    expect(onSetMuted).toHaveBeenLastCalledWith("t-2", false);
  });

  it("asks before deleting a channel", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    setup([], { textChannels: texts, channelMenu: { onDelete } });

    rightClick("ogólny");
    await user.click(screen.getByRole("menuitem", { name: "Usuń kanał" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Usunąć kanał ogólny?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    expect(onDelete).toHaveBeenCalledWith("t-1");
  });

  it("puts the same menu on a voice channel, without the badge item", () => {
    setup([], { channelMenu: { onMarkRead: vi.fn(), onInvite: vi.fn() } });

    rightClick("Ogólny");

    const menu = screen.getByRole("menu", { name: "Kanał głosowy Ogólny" });
    expect(within(menu).queryByRole("menuitem", { name: "Oznacz jako przeczytane" }))
      .toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /powiadomienia kanału/i }))
      .toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Zaproś znajomych" }))
      .toBeInTheDocument();
  });
});
