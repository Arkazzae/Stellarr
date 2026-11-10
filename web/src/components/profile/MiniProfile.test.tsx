import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProfileVM } from "@/components/view-models";

import { MiniProfile, type MiniProfileProps } from "./MiniProfile";

function profile(overrides: Partial<ProfileVM> = {}): ProfileVM {
  return {
    person: {
      id: "u-ada-8",
      displayName: "Ada",
      initials: "AD",
      presence: "online",
    },
    username: "ada",
    relation: "friend",
    roles: [],
    ...overrides,
  };
}

/** The anchor is a real element on the page, the way the app always has one. */
function setup(overrides: Partial<MiniProfileProps> = {}) {
  const anchor = document.createElement("button");
  document.body.append(anchor);

  const props: MiniProfileProps = {
    profile: profile(),
    anchor,
    onClose: vi.fn(),
    onMessage: vi.fn(),
    onAddFriend: vi.fn(),
    onUnblock: vi.fn(),
    onEditProfile: vi.fn(),
    onAcceptRequest: vi.fn(),
    onDeclineRequest: vi.fn(),
    onCancelRequest: vi.fn(),
    ...overrides,
  };

  render(<MiniProfile {...props} />);
  return { ...props, anchor };
}

describe("MiniProfile", () => {
  it("names itself for assistive tech and prints who the person is", () => {
    setup();

    expect(
      screen.getByRole("dialog", { name: "Profil: Ada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("@ada")).toBeInTheDocument();
    expect(screen.getByText("W sieci")).toBeInTheDocument();
  });

  it("renders the authored profile formatting instead of its Markdown markers", () => {
    setup({
      profile: profile({
        bio: "Lubię **dobry dźwięk**. [Portfolio](https://example.com)",
      }),
    });

    expect(screen.getByText("dobry dźwięk").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "Portfolio" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("renders a custom status separately from the profile bio", () => {
    setup({
      profile: profile({
        customStatus: "🎧 na słuchawkach",
        bio: "Buduję rzeczy.",
      }),
    });

    expect(screen.getByText("🎧 na słuchawkach")).toHaveClass("mp-status");
    expect(screen.getByText("Buduję rzeczy.")).toHaveClass("mp-bio");
  });

  it("renders role names in their role color without a leading dot", () => {
    setup({
      profile: profile({
        roles: [{ id: "role-admin", name: "Administrator", color: "#ff6b6b" }],
        joinedAt: "12 lipca 2026",
      }),
    });

    const role = screen.getByText("Administrator");
    expect(role).toHaveStyle({
      color: "#ff6b6b",
    });
    expect(role.querySelector(".dot")).toBeNull();
    expect(role.closest(".mp-fact-row")).toContainElement(
      screen.getByText("12 lipca 2026"),
    );
  });

  it("sends what was typed and leaves the field empty", async () => {
    const user = userEvent.setup();
    const { onMessage } = setup();

    await user.type(screen.getByLabelText("Napisz do Ada"), "cześć{Enter}");

    expect(onMessage).toHaveBeenCalledWith("cześć");
  });

  it("does not raise the message field after a touch opening", () => {
    setup({ autoFocus: false });

    expect(screen.getByLabelText("Napisz do Ada")).not.toHaveFocus();
  });

  it("still moves focus into the card after a keyboard opening", () => {
    setup({ autoFocus: true });

    expect(screen.getByLabelText("Napisz do Ada")).toHaveFocus();
  });

  it("offers an invitation to someone who is not a friend, and nothing else", () => {
    const { onAddFriend } = setup({ profile: profile({ relation: "none" }) });

    expect(
      screen.getByRole("button", { name: "Wyślij zaproszenie do Ada" }),
    ).toBeInTheDocument();
    // Ending a relationship lives in the friends list, not on this card.
    expect(screen.queryByText("Zablokuj")).not.toBeInTheDocument();
    expect(onAddFriend).not.toHaveBeenCalled();
  });

  it("answers a pending invitation both ways", async () => {
    const user = userEvent.setup();
    const { onAcceptRequest, onDeclineRequest } = setup({
      profile: profile({ relation: "incoming", requestId: "req-1" }),
    });

    await user.click(
      screen.getByRole("button", { name: "Przyjmij zaproszenie od Ada" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Odrzuć zaproszenie od Ada" }),
    );

    expect(onAcceptRequest).toHaveBeenCalledOnce();
    expect(onDeclineRequest).toHaveBeenCalledOnce();
  });

  it("will not offer to write to someone who is blocked", () => {
    setup({ profile: profile({ relation: "blocked" }) });

    expect(screen.queryByLabelText("Napisz do Ada")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Odblokuj Ada" }),
    ).toBeInTheDocument();
  });

  it("closes on Escape without letting the press reach the shell", async () => {
    const user = userEvent.setup();
    const onWindowEscape = vi.fn();
    window.addEventListener("keydown", onWindowEscape);
    const { onClose } = setup();

    await user.keyboard("{Escape}");

    window.removeEventListener("keydown", onWindowEscape);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onWindowEscape).not.toHaveBeenCalled();
  });

  it("closes on a click elsewhere, but not on the anchor that opened it", async () => {
    const user = userEvent.setup();
    const { onClose, anchor } = setup();

    await user.click(anchor);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
