import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DmConversationVM } from "@/components/view-models";

import { DmRail, type DmRailProps } from "./DmRail";

function conversation(
  id: string,
  displayName: string,
  overrides: Partial<DmConversationVM> = {},
): DmConversationVM {
  return {
    id,
    peer: {
      id: `u-${id}`,
      displayName,
      initials: displayName.slice(0, 2).toUpperCase(),
      presence: "online",
    },
    preview: `Ostatnia wiadomość od ${displayName}`,
    unread: 0,
    ...overrides,
  };
}

function baseProps(overrides: Partial<DmRailProps> = {}): DmRailProps {
  return {
    onBackToServer: vi.fn(),
    friendsActive: false,
    onOpenFriends: vi.fn(),
    pending: 0,
    conversations: [conversation("1", "Maja"), conversation("2", "Ola")],
    activeDmId: null,
    onSelect: vi.fn(),
    onAddFriend: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<DmRailProps> = {}) {
  const props = baseProps(overrides);
  render(<DmRail {...props} />);
  return props;
}

describe("DmRail conversations", () => {
  it("opens the conversation that was pressed", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();

    await user.click(screen.getByRole("button", { name: /Ola/ }));

    expect(onSelect).toHaveBeenCalledWith("2");
  });

  it("marks the open conversation as the current page", () => {
    setup({ activeDmId: "2" });

    expect(screen.getByRole("button", { name: /Ola/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: /Maja/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("filters conversations by the name typed, ignoring case and padding", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByRole("searchbox", { name: "Znajdź rozmowę" }), "  OLA ");

    expect(screen.queryByRole("button", { name: /Maja/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Ola/ })).toBeInTheDocument();
  });

  it("says so when nothing matches the search", async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("Żadna rozmowa nie pasuje do „zzz”.")).toBeInTheDocument();
  });

  it("explains the empty list when there are no conversations", () => {
    setup({ conversations: [] });

    expect(screen.getByText(/Nie masz jeszcze żadnej rozmowy/)).toBeInTheDocument();
  });

  it("shows the unread count in place of the call marker", () => {
    setup({
      conversations: [
        conversation("1", "Maja", { unread: 3, callActive: true }),
        conversation("2", "Ola", { callActive: true }),
      ],
    });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Trwa rozmowa")).toHaveLength(1);
  });

  it("names each person's presence for readers who cannot see the dot", () => {
    setup({
      conversations: [
        conversation("1", "Maja", {
          peer: { id: "u-1", displayName: "Maja", initials: "MA", presence: "dnd" },
        }),
      ],
    });

    expect(screen.getByRole("button", { name: /Maja.*Nie przeszkadzać/ })).toBeInTheDocument();
  });
});

describe("DmRail header", () => {
  it("reports the Friends view as the current page while it is showing", () => {
    setup({ friendsActive: true });

    expect(screen.getByRole("button", { name: /Znajomi/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("badges pending friend requests with a spoken count", () => {
    setup({ pending: 2 });

    expect(screen.getByRole("button", { name: /Znajomi.*2.*zaproszenia oczekują/ }))
      .toBeInTheDocument();
  });

  it("opens the add-friend tab without a server-column toggle", async () => {
    const user = userEvent.setup();
    const { onAddFriend } = setup();

    await user.click(screen.getByRole("button", { name: "Dodaj znajomego" }));
    expect(screen.queryByRole("button", { name: "Serwery i wiadomości prywatne" })).not.toBeInTheDocument();

    expect(onAddFriend).toHaveBeenCalledOnce();
  });

  it("makes a shut drawer inert, and an open rail interactive", () => {
    const { unmount } = render(<DmRail {...baseProps()} hidden />);
    expect(screen.getByRole("navigation", { hidden: true })).toHaveAttribute("inert");
    unmount();

    render(<DmRail {...baseProps()} />);
    expect(screen.getByRole("navigation")).not.toHaveAttribute("inert");
  });
});
