import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { UserMenu, type UserMenuProps } from "./UserMenu";

function setup(overrides: Partial<UserMenuProps> = {}) {
  const props: UserMenuProps = {
    at: { x: 20, y: 20 },
    userId: "u-2",
    displayName: "Jo",
    anchor: document.createElement("div"),
    onClose: vi.fn(),
    onOpenProfile: vi.fn(),
    onMessage: vi.fn(),
    ...overrides,
  };
  renderWithConfirm(<UserMenu {...props} />);
  return props;
}

function labels(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

afterEach(() => vi.restoreAllMocks());

describe("UserMenu", () => {
  it("stays short: who they are, and talking to them", () => {
    setup();
    expect(labels()).toEqual(["Profil", "Wyślij wiadomość"]);
  });

  it("offers one friendship item, never two", () => {
    const actions = {
      relationOf: () => "friend" as const,
      onAddFriend: vi.fn(),
      onRemoveFriend: vi.fn(),
      onBlock: vi.fn(),
      onUnblock: vi.fn(),
    };
    setup(actions);

    // Where you already stand is known here, so the menu answers it instead of
    // listing both and leaving the reader to work out which one is live.
    expect(labels()).toContain("Usuń ze znajomych");
    expect(labels()).not.toContain("Dodaj do znajomych");
    expect(labels()).not.toContain("Odblokuj");
  });

  it("swaps the block for an unblock once they are blocked", () => {
    setup({
      relationOf: () => "blocked" as const,
      onBlock: vi.fn(),
      onUnblock: vi.fn(),
    });

    expect(labels()).toContain("Odblokuj");
    expect(labels()).not.toContain("Zablokuj");
  });

  it("keeps moderation out of everyone else's menu", () => {
    setup({ onKick: vi.fn(), onBan: vi.fn() });

    expect(labels()).not.toContain("Wyrzuć z serwera");
    expect(labels()).not.toContain("Zbanuj");
  });

  it("adjusts a remote participant locally without closing the menu", () => {
    const onParticipantVolumeChange = vi.fn();
    const props = setup({
      participantVolumeOf: () => 125,
      onParticipantVolumeChange,
    });

    const slider = screen.getByRole("slider", { name: "Głośność: Jo" });
    expect(slider).toHaveValue("125");
    fireEvent.change(slider, { target: { value: "160" } });

    expect(onParticipantVolumeChange).toHaveBeenCalledWith("u-2", 160);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("puts the kick and the ban last, and asks before either", async () => {
    const user = userEvent.setup();
    const onKick = vi.fn();
    const onBan = vi.fn();
    setup({ canKick: true, canBan: true, onKick, onBan });

    // Last, and below a rule: the two items that end somebody's presence must
    // not sit where a hand aiming at "Wyślij wiadomość" can reach them.
    expect(labels().slice(-2)).toEqual(["Wyrzuć z serwera", "Zbanuj"]);

    await user.click(screen.getByRole("menuitem", { name: "Wyrzuć z serwera" }));
    // Asked in the app's own dialog, which outlives the menu that raised it.
    expect(screen.getByRole("dialog")).toHaveTextContent("Wyrzucić Jo?");
    await answerConfirm(user, "Anuluj");
    expect(onKick).not.toHaveBeenCalled();
  });

  it("kicks once the question is answered", async () => {
    const user = userEvent.setup();
    const onKick = vi.fn();
    setup({ canKick: true, onKick });

    await user.click(screen.getByRole("menuitem", { name: "Wyrzuć z serwera" }));
    await answerConfirm(user, "Wyrzuć");

    expect(onKick).toHaveBeenCalledWith("u-2");
  });

  it("offers a separate voice-only kick for a person currently in a channel", async () => {
    const user = userEvent.setup();
    const onKickFromChannel = vi.fn();
    setup({
      canKick: true,
      canKickFromChannel: () => true,
      onKickFromChannel,
    });

    await user.click(screen.getByRole("menuitem", { name: "Wyrzuć z kanału" }));
    await answerConfirm(user, "Rozłącz");

    expect(onKickFromChannel).toHaveBeenCalledWith("u-2");
  });

  it("carries the ban's reason through to the list that shows it", async () => {
    const user = userEvent.setup();
    const onBan = vi.fn();
    setup({ canBan: true, onBan });

    await user.click(screen.getByRole("menuitem", { name: "Zbanuj" }));
    await user.type(screen.getByRole("textbox", { name: "POWÓD" }), "  spam  ");
    await answerConfirm(user, "Zbanuj");

    expect(onBan).toHaveBeenCalledWith("u-2", "spam");
  });

  it("bans without a reason, because the list has a word for that", async () => {
    const user = userEvent.setup();
    const onBan = vi.fn();
    setup({ canBan: true, onBan });

    await user.click(screen.getByRole("menuitem", { name: "Zbanuj" }));
    await answerConfirm(user, "Zbanuj");

    // Empty is an answer; it is dismissing the question that is not.
    expect(onBan).toHaveBeenCalledWith("u-2", "");
  });

  it("does nothing when the ban prompt is dismissed", async () => {
    const user = userEvent.setup();
    const onBan = vi.fn();
    setup({ canBan: true, onBan });

    await user.click(screen.getByRole("menuitem", { name: "Zbanuj" }));
    await user.type(screen.getByRole("textbox", { name: "POWÓD" }), "spam");
    await answerConfirm(user, "Anuluj");

    expect(onBan).not.toHaveBeenCalled();
  });

  it("asks before ending a friendship", async () => {
    const user = userEvent.setup();
    const onRemoveFriend = vi.fn();
    setup({ relationOf: () => "friend" as const, onRemoveFriend });

    await user.click(screen.getByRole("menuitem", { name: "Usuń ze znajomych" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Usunąć Jo ze znajomych?",
    );
    await answerConfirm(user, "Anuluj");
    expect(onRemoveFriend).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: "Usuń ze znajomych" }));
    await answerConfirm(user, "Usuń");
    expect(onRemoveFriend).toHaveBeenCalledWith("u-2");
  });

  it("asks before blocking", async () => {
    const user = userEvent.setup();
    const onBlock = vi.fn();
    setup({ onBlock });

    await user.click(screen.getByRole("menuitem", { name: "Zablokuj" }));
    await answerConfirm(user, "Zablokuj");

    expect(onBlock).toHaveBeenCalledWith("u-2");
  });

  it("offers nothing to do to yourself but open your own card", () => {
    setup({
      self: true,
      canKick: true,
      canBan: true,
      onKick: vi.fn(),
      onBan: vi.fn(),
      onBlock: vi.fn(),
      relationOf: () => "self" as const,
      participantVolumeOf: () => 125,
      onParticipantVolumeChange: vi.fn(),
    });

    expect(labels()).toEqual(["Profil"]);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
