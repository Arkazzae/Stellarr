import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PersonVM } from "@/components/view-models";
import { translateMessage } from "@/i18n";
import { renderWithConfirm } from "@/test/confirm";

import { PersonRow, personState } from "./PersonRow";

const MAJA: PersonVM = {
  id: "u-maja",
  displayName: "Maja",
  initials: "MA",
  presence: "online",
};

const t = (key: Parameters<typeof translateMessage>[1]) => translateMessage("pl", key);

describe("personState", () => {
  it("describes someone in a call by their microphone", () => {
    expect(personState({ ...MAJA, speaking: true }, true, t)).toBe("Mówi");
    expect(personState(MAJA, true, t)).toBe("Cisza");
  });

  it("describes everyone else by their presence", () => {
    expect(personState({ ...MAJA, presence: "idle" }, false, t)).toBe("Zaraz wracam");
    expect(personState({ ...MAJA, presence: "dnd" }, false, t)).toBe("Nie przeszkadzać");
    expect(personState({ ...MAJA, presence: "offline" }, false, t)).toBe("Poza siecią");
  });
});

describe("PersonRow", () => {
  it("opens the profile from the element that was clicked", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<PersonRow person={MAJA} onOpenProfile={onOpenProfile} />);

    const row = screen.getByRole("button", { name: /Maja/ });
    await user.click(row);

    expect(onOpenProfile).toHaveBeenCalledWith(row);
  });

  it("is inert without a profile handler and without a menu", () => {
    const { container } = render(<PersonRow person={MAJA} />);

    expect(screen.queryByRole("button")).toBeNull();
    // The browser keeps its own menu when there is nothing to replace it with.
    expect(fireEvent.contextMenu(container.querySelector(".person")!)).toBe(true);
  });

  it("says who is speaking and who is away in words as well as colour", () => {
    const { rerender } = render(<PersonRow person={{ ...MAJA, speaking: true }} inCall />);
    expect(screen.getByText("Mówi")).toBeInTheDocument();
    expect(screen.getByText("Maja").closest(".person")).toHaveClass("speaking");

    rerender(<PersonRow person={{ ...MAJA, presence: "offline" }} />);
    expect(screen.getByText("Poza siecią")).toBeInTheDocument();
    expect(screen.getByText("Maja").closest(".person")).toHaveClass("offline");
  });

  it("opens the menu at the pointer on right-click, and closes it again", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    const { container } = renderWithConfirm(
      <PersonRow person={MAJA} menu={{ onMessage }} />,
    );

    const notPrevented = fireEvent.contextMenu(container.querySelector(".person")!);
    expect(notPrevented).toBe(false);
    expect(screen.getByRole("menu", { name: "Maja" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lets Shift+right-click through to the browser", () => {
    const { container } = renderWithConfirm(
      <PersonRow person={MAJA} menu={{ onMessage: vi.fn() }} />,
    );

    fireEvent.contextMenu(container.querySelector(".person")!, { shiftKey: true });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("hangs the profile opened from the menu off the row's own button", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    renderWithConfirm(
      <PersonRow person={MAJA} menu={{ onOpenProfile }} />,
    );

    const more = screen.getByRole("button", { name: "Więcej działań: Maja" });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Profil" }));

    expect(onOpenProfile).toHaveBeenCalledWith("u-maja", more);
  });

  it("marks your own row so the menu offers nothing to do to yourself", async () => {
    const user = userEvent.setup();
    renderWithConfirm(
      <PersonRow person={MAJA} menu={{ self: true, onMessage: vi.fn(), onOpenProfile: vi.fn() }} />,
    );

    await user.click(screen.getByRole("button", { name: "Więcej działań: Maja" }));

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Profil"]);
  });
});
