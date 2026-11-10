import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";

import { ChannelMenu, type ChannelMenuProps } from "./ChannelMenu";

function renderMenu(overrides: Partial<ChannelMenuProps> = {}) {
  const props: ChannelMenuProps = {
    at: { x: 40, y: 40 },
    channelId: "c-1",
    kind: "text",
    name: "ogólny",
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(
    <ConfirmProvider>
      <ChannelMenu {...props} />
    </ConfirmProvider>,
  );
  return { props, ...view };
}

const sections = [
  { id: "s-1", name: "Gry" },
  { id: "s-2", name: "Praca" },
];

describe("ChannelMenu", () => {
  it("renders nothing when no action is on offer", () => {
    renderMenu();

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers every other section as a target when the channel has none", async () => {
    const user = userEvent.setup();
    const onMoveToSection = vi.fn();
    renderMenu({ sections, onMoveToSection });

    const menu = screen.getByRole("menu", { name: "Kanał ogólny" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent))
      .toEqual(["Przenieś do: Gry", "Przenieś do: Praca"]);

    await user.click(
      within(menu).getByRole("menuitem", { name: "Przenieś do: Praca" }),
    );
    expect(onMoveToSection).toHaveBeenCalledWith("c-1", "s-2");
  });

  it("skips the section the channel already sits in and offers to leave it", async () => {
    const user = userEvent.setup();
    const onMoveToSection = vi.fn();
    renderMenu({ sections, onMoveToSection, currentSectionId: "s-1" });

    expect(screen.queryByRole("menuitem", { name: "Przenieś do: Gry" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Przenieś do: Praca" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Usuń z sekcji" }));
    expect(onMoveToSection).toHaveBeenCalledWith("c-1", null);
  });

  it("offers no section moves without somewhere to send them", () => {
    renderMenu({ sections, onInvite: vi.fn() });

    expect(screen.queryByRole("menuitem", { name: /Przenieś do/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Usuń z sekcji" })).toBeNull();
  });

  it("separates the groups of items and nothing else", () => {
    renderMenu({
      onInvite: vi.fn(),
      onOpenSettings: vi.fn(),
      onDelete: vi.fn(),
      developerMode: true,
    });

    const menu = screen.getByRole("menu");
    expect(
      within(menu).getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Zaproś znajomych",
      "Ustawienia kanału",
      "Usuń kanał",
      "Kopiuj identyfikator",
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
  });

  it("copies the channel id in developer mode", async () => {
    const user = userEvent.setup();
    renderMenu({ developerMode: true });

    await user.click(
      screen.getByRole("menuitem", { name: "Kopiuj identyfikator" }),
    );

    expect(await navigator.clipboard.readText()).toBe("c-1");
  });

  it("does not offer the copy item outside developer mode", () => {
    renderMenu({ onInvite: vi.fn() });

    expect(screen.queryByRole("menuitem", { name: "Kopiuj identyfikator" }))
      .toBeNull();
  });

  it("leaves settings out when the member may not open them for this kind", () => {
    renderMenu({
      kind: "voice",
      name: "Rozmowa",
      onOpenSettings: vi.fn(),
      canOpenSettings: (_id, kind) => kind === "text",
      onInvite: vi.fn(),
    });

    const menu = screen.getByRole("menu", { name: "Kanał głosowy Rozmowa" });
    expect(within(menu).queryByRole("menuitem", { name: "Ustawienia kanału" }))
      .toBeNull();
  });

  it("keeps the channel when the deletion is declined", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderMenu({ onDelete });

    await user.click(screen.getByRole("menuitem", { name: "Usuń kanał" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(onDelete).not.toHaveBeenCalled();
  });
});
