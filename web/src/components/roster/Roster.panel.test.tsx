import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PersonVM } from "@/components/view-models";
import { renderWithConfirm } from "@/test/confirm";

import { Roster, type RosterProps } from "./Roster";

const MAJA: PersonVM = { id: "u-maja", displayName: "Maja", initials: "MA", presence: "online" };
const NILS: PersonVM = { id: "u-nils", displayName: "Nils", initials: "NI", presence: "offline" };

function props(overrides: Partial<RosterProps> = {}): RosterProps {
  return {
    open: true,
    online: [MAJA],
    offline: [NILS],
    voiceUserIds: new Set(),
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onOpenProfile: vi.fn(),
    ...overrides,
  };
}

describe("Roster panel", () => {
  it("says so when nobody is here, and draws no empty groups", () => {
    const { container } = render(<Roster {...props({ online: [], offline: [] })} />);

    expect(screen.getByText("Nikogo tu nie ma.")).toBeInTheDocument();
    expect(container.querySelector(".roster-group")).toBeNull();
  });

  it("leaves a group out when it has nobody in it", () => {
    render(<Roster {...props({ offline: [] })} />);

    expect(screen.getByRole("heading", { name: "W sieci1" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Poza siecią/ })).toBeNull();
    expect(screen.queryByText("Nikogo tu nie ma.")).toBeNull();
  });

  it("takes a closed drawer out of reach, but not the avatar column", () => {
    const { container, rerender } = render(<Roster {...props({ open: false })} />);
    expect(container.querySelector(".roster")).toHaveAttribute("inert");

    rerender(<Roster {...props({ open: false, mini: true })} />);
    expect(container.querySelector(".roster")).not.toHaveAttribute("inert");

    rerender(<Roster {...props({ open: true })} />);
    expect(container.querySelector(".roster")).not.toHaveAttribute("inert");
  });

  it("expands and collapses from its own controls", async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    render(<Roster {...props({ onExpand, onCollapse })} />);

    await user.click(screen.getByRole("button", { name: "Rozwiń panel osób" }));
    await user.click(screen.getByRole("button", { name: "Zwiń panel osób" }));

    expect(onExpand).toHaveBeenCalledOnce();
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it("lists everyone as a face in the column, online first, naming their state", () => {
    render(<Roster {...props({ voiceUserIds: new Set(["u-maja"]) })} />);

    const column = document.querySelector<HTMLElement>(".mini-list")!;
    const faces = within(column).getAllByRole("button");

    expect(faces.map((face) => face.getAttribute("aria-label"))).toEqual([
      "Maja — Cisza",
      "Nils — Poza siecią",
    ]);
  });

  it("opens a profile from a face in the column", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<Roster {...props({ onOpenProfile })} />);

    const face = screen.getByRole("button", { name: "Nils — Poza siecią" });
    await user.click(face);

    expect(onOpenProfile).toHaveBeenCalledWith("u-nils", face);
  });

  it("opens a profile from a row in the list", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<Roster {...props({ onOpenProfile })} />);

    const list = document.querySelector<HTMLElement>(".roster-list")!;
    const row = within(list).getByRole("button", { name: /Maja/ });
    await user.click(row);

    expect(onOpenProfile).toHaveBeenCalledWith("u-maja", row);
  });

  it("raises the menu for the person whose row it was, and knows which row is yours", async () => {
    const user = userEvent.setup();
    const onMessage = vi.fn();
    renderWithConfirm(
      <Roster {...props({ menu: { selfId: "u-maja", onMessage, developerMode: true } })} />,
    );

    await user.click(screen.getByRole("button", { name: "Więcej działań: Maja" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Kopiuj identyfikator",
    ]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Więcej działań: Nils" }));
    await user.click(screen.getByRole("menuitem", { name: "Wyślij wiadomość" }));
    expect(onMessage).toHaveBeenCalledWith("u-nils");
  });
});
