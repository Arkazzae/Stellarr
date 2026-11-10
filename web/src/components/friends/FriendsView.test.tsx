import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";
import { FriendsView } from "./FriendsView";
import type { FriendsTab } from "@/components/view-models";

function view(tab: FriendsTab, overrides: Partial<Parameters<typeof FriendsView>[0]> = {}) {
  const props = {
    tab,
    onTabChange: vi.fn(),
    friends: [],
    requests: [],
    blocked: [],
    supported: true,
    railOpen: false,
    onToggleRail: vi.fn(),
    onMessage: vi.fn(),
    onCall: vi.fn(),
    onRemove: vi.fn(),
    onBlock: vi.fn(),
    onUnblock: vi.fn(),
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    onCancel: vi.fn(),
    onAddFriend: vi.fn().mockResolvedValue("sent" as const),
    onOpenProfile: vi.fn(),
    ...overrides,
  };
  // A friend row asks for confirmation before removing somebody.
  render(
    <ConfirmProvider>
      <FriendsView {...props} />
    </ConfirmProvider>,
  );
  return props;
}

describe("FriendsView", () => {
  it("exposes the conversation drawer state from the mobile header", () => {
    view("all", { railOpen: true });

    expect(screen.getByRole("button", { name: "Pokaż rozmowy" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("carries the way out of an empty list, not only the fact of it", async () => {
    const user = userEvent.setup();
    const props = view("all");

    expect(screen.getByText("Nie masz jeszcze znajomych")).toBeTruthy();
    // Two ways to the same form: the header action and the empty state's.
    const add = screen.getAllByRole("button", { name: "Dodaj znajomego" });
    expect(add).toHaveLength(2);

    await user.click(add[1]!);
    expect(props.onTabChange).toHaveBeenCalledWith("add");
  });

  it("blames the search, and offers to undo it, when the query hides everyone", async () => {
    const user = userEvent.setup();
    view("all", {
      friends: [
        {
          person: { id: "u1", displayName: "Kasia", initials: "KA", presence: "online" },
          username: "kasia",
        },
      ],
    });

    await user.type(screen.getByRole("searchbox", { name: /Szukaj/ }), "zzz");
    expect(screen.getByText("Brak wyników")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Wyczyść wyszukiwanie" }));
    expect(screen.getByText("Kasia")).toBeTruthy();
  });

  it("opens row actions beyond the scrolling list and still confirms removal", async () => {
    const user = userEvent.setup();
    const props = view("all", {
      friends: [
        {
          person: { id: "u1", displayName: "Kasia", initials: "KA", presence: "online" },
          username: "kasia",
        },
      ],
    });

    const trigger = screen.getByRole("button", { name: "Więcej działań: Kasia" });
    await user.click(trigger);

    const menu = screen.getByRole("dialog", { name: "Więcej działań: Kasia" });
    expect(menu.parentElement).toBe(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Usuń ze znajomych" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { name: "Usunąć Kasia ze znajomych?" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    expect(props.onRemove).toHaveBeenCalledWith("u1");
  });

  it("says nothing is blocked without offering an action for it", () => {
    view("blocked");

    expect(screen.getByText("Nikt nie jest zablokowany")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Dodaj znajomego" })).toHaveLength(1);
  });
});
