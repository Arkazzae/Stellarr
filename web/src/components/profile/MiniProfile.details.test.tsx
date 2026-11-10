import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PersonVM, ProfileVM } from "@/components/view-models";
import { defaultIdentityArt } from "@/design/identity";
import type { CustomEmoji } from "@/ports";

import { MiniProfile } from "./MiniProfile";

function show(
  overrides: Partial<ProfileVM> = {},
  person: Partial<PersonVM> = {},
  customEmoji: CustomEmoji[] = [],
) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  render(
    <MiniProfile
      profile={{
        person: {
          id: "u-ada-8",
          displayName: "Ada",
          initials: "AD",
          presence: "online",
          ...person,
        },
        username: "ada",
        relation: "friend",
        roles: [],
        ...overrides,
      }}
      customEmoji={customEmoji}
      anchor={anchor}
      onClose={vi.fn()}
      onMessage={vi.fn()}
      onAddFriend={vi.fn()}
      onUnblock={vi.fn()}
      onEditProfile={vi.fn()}
      onAcceptRequest={vi.fn()}
      onDeclineRequest={vi.fn()}
      onCancelRequest={vi.fn()}
    />,
  );
}

describe("MiniProfile details", () => {
  it("prints pronouns beside the username exactly as typed", () => {
    show({ pronouns: "ona/jej" });

    expect(screen.getByText("ona/jej").closest(".mp-tag")).toHaveTextContent(
      "@adaona/jej",
    );
  });

  it.each([
    ["online", "W sieci"],
    ["idle", "Zaraz wracam"],
    ["dnd", "Nie przeszkadzać"],
    ["offline", "Poza siecią"],
  ] as const)("says in words that someone is %s", (presence, word) => {
    show({}, { presence });

    expect(screen.getByRole("dialog")).toHaveTextContent(word);
  });

  it("falls back to the built-in banner when nothing was uploaded", () => {
    show();

    const banner = document.querySelector(".mp-banner img");
    expect(banner).toHaveAttribute(
      "src",
      defaultIdentityArt("u-ada-8").bannerUrl,
    );
  });

  it("prefers uploaded banner artwork", () => {
    show({ bannerUrl: "/uploads/banner.webp" });

    expect(document.querySelector(".mp-banner img")).toHaveAttribute(
      "src",
      "/uploads/banner.webp",
    );
  });

  it("leaves out a status or bio that is only whitespace", () => {
    show({ customStatus: "  ", bio: "\n " });

    expect(document.querySelector(".mp-status")).toBeNull();
    expect(document.querySelector(".mp-bio")).toBeNull();
  });

  it("keeps a bio's links out of the status line", () => {
    show({ customStatus: "https://example.com" });

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names the voice channel someone is in", () => {
    show({ voiceChannelName: "Salon" });

    expect(screen.getByText("W rozmowie")).toBeInTheDocument();
    expect(screen.getByText("Salon")).toBeInTheDocument();
  });

  it("shows when the friendship began", () => {
    show({ friendsSince: "3 marca 2026" });

    expect(screen.getByText("Znajomi od")).toBeInTheDocument();
    expect(screen.getByText("3 marca 2026")).toBeInTheDocument();
  });

  it("shows when they joined even without any roles", () => {
    show({ joinedAt: "12 lipca 2026" });

    expect(screen.getByText("Na serwerze od")).toBeInTheDocument();
    expect(screen.queryByText("Role")).not.toBeInTheDocument();
  });

  it("renders a custom emoji in the status", () => {
    show({ customStatus: "party :party:" }, {}, [
      { id: "e1", shortcode: ":party:", glyph: "/emoji/party.webp" },
    ]);

    expect(screen.getByRole("img", { name: ":party:" })).toHaveAttribute(
      "src",
      "/emoji/party.webp",
    );
  });
});
