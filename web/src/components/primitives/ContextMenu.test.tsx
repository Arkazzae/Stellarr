import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu, type MenuEntry } from "./ContextMenu";

const AT = { x: 40, y: 40 };

describe("ContextMenu", () => {
  it("runs an item and closes behind it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        at={AT}
        label="Wiadomość"
        onClose={onClose}
        entries={[{ id: "a", label: "Odpowiedz", onSelect }]}
      />,
    );

    await user.click(screen.getByRole("menuitem", { name: "Odpowiedz" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("drops separators that ended up at an edge or doubled up", () => {
    // This is what a menu looks like once permission has removed the items
    // around its rules — the rules must not be left behind.
    const entries: MenuEntry[] = [
      "separator",
      { id: "a", label: "Profil", onSelect: vi.fn() },
      "separator",
      "separator",
      { id: "b", label: "Kopiuj", onSelect: vi.fn() },
      "separator",
    ];
    render(
      <ContextMenu at={AT} label="Maja" onClose={vi.fn()} entries={entries} />,
    );

    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("walks with the arrows and runs with Enter", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    render(
      <ContextMenu
        at={AT}
        label="Wiadomość"
        onClose={vi.fn()}
        entries={[
          { id: "a", label: "Odpowiedz", onSelect: first },
          { id: "b", label: "Kopiuj tekst", onSelect: second },
        ]}
      />,
    );

    await user.keyboard("{ArrowDown}{Enter}");

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("closes on Escape without running anything", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        at={AT}
        label="Wiadomość"
        onClose={onClose}
        entries={[{ id: "a", label: "Usuń", danger: true, onSelect }]}
      />,
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
