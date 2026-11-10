import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithConfirm } from "@/test/confirm";

import { UserMenu, type UserMenuProps } from "./UserMenu";

function setup(overrides: Partial<UserMenuProps> = {}) {
  const props: UserMenuProps = {
    at: { x: 20, y: 20 },
    userId: "u-2",
    displayName: "Jo",
    anchor: document.createElement("div"),
    onClose: vi.fn(),
    ...overrides,
  };
  renderWithConfirm(<UserMenu {...props} />);
  return props;
}

function labels(): string[] {
  return screen.queryAllByRole("menuitem").map((item) => item.textContent ?? "");
}

afterEach(() => vi.restoreAllMocks());

describe("UserMenu actions", () => {
  it("hands the profile the element the menu was raised from", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    const props = setup({ onOpenProfile });

    await user.click(screen.getByRole("menuitem", { name: "Profil" }));

    expect(onOpenProfile).toHaveBeenCalledWith("u-2", props.anchor);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("leaves the profile out when there is nothing to hang the card off", () => {
    setup({ anchor: null, onOpenProfile: vi.fn(), onMessage: vi.fn() });

    expect(labels()).toEqual(["Wyślij wiadomość"]);
  });

  it("adds a friend without asking, because it is undone by asking again", async () => {
    const user = userEvent.setup();
    const onAddFriend = vi.fn();
    setup({ relationOf: () => "none", onAddFriend });

    await user.click(screen.getByRole("menuitem", { name: "Dodaj do znajomych" }));

    expect(onAddFriend).toHaveBeenCalledWith("u-2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unblocks without asking", async () => {
    const user = userEvent.setup();
    const onUnblock = vi.fn();
    setup({ relationOf: () => "blocked", onUnblock });

    await user.click(screen.getByRole("menuitem", { name: "Odblokuj" }));

    expect(onUnblock).toHaveBeenCalledWith("u-2");
  });

  it.each(["incoming", "outgoing"] as const)(
    "offers no friendship item while an invitation is pending (%s)",
    (relation) => {
      setup({
        relationOf: () => relation,
        onAddFriend: vi.fn(),
        onRemoveFriend: vi.fn(),
        onUnblock: vi.fn(),
        onBlock: vi.fn(),
      });

      expect(labels()).toEqual(["Zablokuj"]);
    },
  );

  it("hides the voice-only kick for someone who is not in a channel", () => {
    setup({
      canKick: true,
      onKick: vi.fn(),
      canKickFromChannel: () => false,
      onKickFromChannel: vi.fn(),
    });

    expect(labels()).toEqual(["Wyrzuć z serwera"]);
  });

  it("puts the voice-only kick before the server kick", () => {
    setup({
      canKick: true,
      canBan: true,
      onKick: vi.fn(),
      onBan: vi.fn(),
      canKickFromChannel: () => true,
      onKickFromChannel: vi.fn(),
    });

    expect(labels()).toEqual(["Wyrzuć z kanału", "Wyrzuć z serwera", "Zbanuj"]);
  });

  describe("the rule above moderation", () => {
    function ruleAbove(name: string): boolean {
      const item = screen.getByRole("menuitem", { name });
      return item.previousElementSibling?.getAttribute("role") === "separator";
    }

    it("is drawn above the kick items", () => {
      setup({
        onBlock: vi.fn(),
        relationOf: () => "none",
        canKick: true,
        canBan: true,
        onKick: vi.fn(),
        onBan: vi.fn(),
        canKickFromChannel: () => true,
        onKickFromChannel: vi.fn(),
      });

      expect(ruleAbove("Wyrzuć z kanału")).toBe(true);
      expect(ruleAbove("Wyrzuć z serwera")).toBe(false);
      expect(ruleAbove("Zbanuj")).toBe(false);
    });

    it("is drawn above the server kick when it is the first of them", () => {
      setup({ onBlock: vi.fn(), relationOf: () => "none", canKick: true, onKick: vi.fn() });

      expect(ruleAbove("Wyrzuć z serwera")).toBe(true);
    });

    it("is not drawn for a ban that stands alone", () => {
      setup({ onBlock: vi.fn(), relationOf: () => "none", canBan: true, onBan: vi.fn() });

      expect(labels()).toEqual(["Zablokuj", "Zbanuj"]);
      expect(ruleAbove("Zbanuj")).toBe(false);
    });
  });

  it("switches the local gate and noise removal without closing the menu", async () => {
    const user = userEvent.setup();
    const onParticipantGateChange = vi.fn();
    const onParticipantSuppressionChange = vi.fn();
    const props = setup({
      participantVolumeOf: () => 100,
      onParticipantVolumeChange: vi.fn(),
      participantGateOf: () => false,
      onParticipantGateChange,
      participantSuppressionOf: () => true,
      onParticipantSuppressionChange,
    });

    await user.click(screen.getByRole("button", { name: "Bramka szumów: Jo" }));
    await user.click(screen.getByRole("button", { name: "Odszumianie u Ciebie: Jo" }));

    expect(onParticipantGateChange).toHaveBeenCalledWith("u-2", true);
    expect(onParticipantSuppressionChange).toHaveBeenCalledWith("u-2", false);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps the gate out of the strip when no handler can apply it", () => {
    setup({
      participantVolumeOf: () => 100,
      onParticipantVolumeChange: vi.fn(),
      participantGateOf: () => false,
    });

    expect(screen.getByRole("slider", { name: "Głośność: Jo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bramka szumów: Jo" })).toBeNull();
  });

  it("shows nothing at all when there is nothing to offer", () => {
    setup({});

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("copies the id only in developer mode", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
    setup({ onMessage: vi.fn(), developerMode: true });

    expect(labels()).toEqual(["Wyślij wiadomość", "Kopiuj identyfikator"]);
    await user.click(screen.getByRole("menuitem", { name: "Kopiuj identyfikator" }));

    expect(writeText).toHaveBeenCalledWith("u-2");
  });

  it("does not offer the id outside developer mode", () => {
    setup({ onMessage: vi.fn() });

    expect(labels()).not.toContain("Kopiuj identyfikator");
  });

  it("still lets you copy your own id", () => {
    setup({ self: true, developerMode: true });

    expect(labels()).toEqual(["Kopiuj identyfikator"]);
  });
});
