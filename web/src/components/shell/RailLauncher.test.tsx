import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailLauncher, type RailLauncherItem } from "./RailLauncher";

const onSelect = vi.fn();
const items: RailLauncherItem[] = [
  { key: "a", icon: "plus", label: "Dodaj", hint: "Nowa rzecz", onSelect },
  { key: "b", icon: "search", label: "Szukaj" },
];

const tile = () => screen.getByRole("button", { name: "Więcej" });
const menu = () => document.querySelector<HTMLElement>(".srv-menu")!;

afterEach(() => {
  vi.useRealTimers();
  onSelect.mockClear();
});

describe("RailLauncher", () => {
  it("names a row after its label and hint, and disables one with nothing behind it", () => {
    render(<RailLauncher items={items} />);

    expect(screen.getByRole("button", { name: "Dodaj. Nowa rzecz", hidden: true })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Szukaj", hidden: true })).toBeDisabled();
  });

  it("opens on focus and closes with Escape, handing focus back to the tile", async () => {
    const user = userEvent.setup();
    const onWindowEscape = vi.fn();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onWindowEscape();
    };
    window.addEventListener("keydown", listener);
    render(<RailLauncher items={items} />);

    await user.tab();
    expect(tile()).toHaveFocus();
    expect(tile()).toHaveAttribute("aria-expanded", "true");

    // The card's rows come before the tile in the tab order.
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Dodaj. Nowa rzecz" })).toHaveFocus();
    expect(tile()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");

    expect(tile()).toHaveAttribute("aria-expanded", "false");
    expect(tile()).toHaveFocus();
    // The shell closes drawers on Escape; the card must take it first.
    expect(onWindowEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", listener);
  });

  it("marks the Escape that closes the card as handled, and no other", async () => {
    const user = userEvent.setup();
    render(<RailLauncher items={items} />);

    await user.tab();
    expect(tile()).toHaveAttribute("aria-expanded", "true");
    // `fireEvent` returns false when the default was prevented, which is how the
    // layer stack on `document` tells that the key is taken.
    expect(fireEvent.keyDown(tile(), { key: "Escape" })).toBe(false);
    expect(tile()).toHaveAttribute("aria-expanded", "false");

    expect(fireEvent.keyDown(tile(), { key: "Escape" })).toBe(true);
  });

  it("stays open under the click that follows a hover, then closes on the next click", async () => {
    const user = userEvent.setup();
    render(<RailLauncher items={items} />);

    await user.hover(tile());
    await user.click(tile());
    expect(tile()).toHaveAttribute("aria-expanded", "true");

    await user.click(tile());
    expect(tile()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes a moment after the pointer leaves, not at once", () => {
    vi.useFakeTimers();
    render(<RailLauncher items={items} />);

    fireEvent.pointerEnter(tile());
    expect(tile()).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerLeave(tile());
    expect(tile()).toHaveAttribute("aria-expanded", "true");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(tile()).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open when the pointer returns before the delay ends", () => {
    vi.useFakeTimers();
    render(<RailLauncher items={items} />);

    fireEvent.pointerEnter(tile());
    fireEvent.pointerLeave(tile());
    fireEvent.pointerEnter(menu());
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(tile()).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on a press outside, which is how a touch screen dismisses it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <RailLauncher items={items} />
        <button>poza</button>
      </>,
    );

    await user.click(tile());
    expect(tile()).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "poza" }));
    expect(tile()).toHaveAttribute("aria-expanded", "false");
  });

  it("runs a row's action and closes", async () => {
    const user = userEvent.setup();
    render(<RailLauncher items={items} />);

    await user.click(tile());
    await user.click(screen.getByRole("button", { name: "Dodaj. Nowa rzecz" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(tile()).toHaveAttribute("aria-expanded", "false");
  });
});
