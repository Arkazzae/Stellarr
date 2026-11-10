import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomHeader, type RoomHeaderProps } from "./RoomHeader";

function props(overrides: Partial<RoomHeaderProps> = {}): RoomHeaderProps {
  return {
    view: "text",
    title: "ogólny",
    rosterOpen: false,
    onToggleRoster: vi.fn(),
    railOpen: false,
    onToggleRail: vi.fn(),
    panelOpen: false,
    onTogglePanel: vi.fn(),
    ...overrides,
  };
}

describe("RoomHeader", () => {
  it("speaks Polish unless it is given a translator", () => {
    render(<RoomHeader {...props()} />);

    expect(screen.getByRole("button", { name: "Pokaż kanały" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Narzędzia kanału" })).toBeInTheDocument();
  });

  it("shows the channel title and topic", () => {
    render(<RoomHeader {...props({ topic: "Wszystko o wszystkim" })} />);

    expect(screen.getByRole("heading", { level: 2, name: "ogólny" })).toBeInTheDocument();
    expect(screen.getByText("Wszystko o wszystkim")).toBeInTheDocument();
  });

  it("toggles the roster and exposes whether it is open", async () => {
    const user = userEvent.setup();
    const onToggleRoster = vi.fn();
    render(<RoomHeader {...props({ rosterOpen: true, onToggleRoster })} />);

    const people = screen.getByRole("button", { name: "Pokaż osoby" });
    expect(people).toHaveAttribute("aria-pressed", "true");
    await user.click(people);

    expect(onToggleRoster).toHaveBeenCalledOnce();
  });

  it("toggles the channel rail from the burger", async () => {
    const user = userEvent.setup();
    const onToggleRail = vi.fn();
    render(<RoomHeader {...props({ onToggleRail })} />);

    await user.click(screen.getByRole("button", { name: "Pokaż kanały" }));

    expect(onToggleRail).toHaveBeenCalledOnce();
  });
});
