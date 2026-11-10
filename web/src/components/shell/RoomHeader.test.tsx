import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Translator } from "@/i18n";

import { RoomHeader, type RoomHeaderProps } from "./RoomHeader";

const t: Translator = (key) => key;

function props(overrides: Partial<RoomHeaderProps> = {}): RoomHeaderProps {
  return {
    view: "text",
    title: "general",
    rosterOpen: false,
    onToggleRoster: vi.fn(),
    railOpen: false,
    onToggleRail: vi.fn(),
    panelOpen: false,
    onTogglePanel: vi.fn(),
    t,
    ...overrides,
  };
}

describe("RoomHeader channel tools", () => {
  it("keeps one channel sidebar toggle in the topbar", async () => {
    const user = userEvent.setup();
    const onTogglePanel = vi.fn();
    render(<RoomHeader {...props({ onTogglePanel })} />);

    expect(screen.queryByRole("button", { name: "common.search" })).toBeNull();
    const panelToggle = screen.getByRole("button", { name: "room.channelPanel" });
    expect(panelToggle.querySelector("path")?.getAttribute("d")).toBe(
      "M7.5 4H16.5C17.12 4 17.67 4.02 18.16 4.09C20.79 4.38 21.5 5.62 21.5 9V15C21.5 18.38 20.79 19.62 18.16 19.91C17.67 19.98 17.12 20 16.5 20H7.5C6.88 20 6.33 19.98 5.84 19.91C3.21 19.62 2.5 18.38 2.5 15V9C2.5 5.62 3.21 4.38 5.84 4.09C6.33 4.02 6.88 4 7.5 4Z",
    );
    await user.click(panelToggle);

    expect(onTogglePanel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "room.pinnedMessages" })).toBeNull();
    expect(screen.queryByRole("button", { name: "room.media" })).toBeNull();
    expect(screen.queryByRole("button", { name: "room.links" })).toBeNull();
  });

  it("exposes the sidebar toggle state", () => {
    render(<RoomHeader {...props({ panelOpen: true })} />);

    expect(screen.getByRole("button", { name: "room.channelPanel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("exposes the mobile navigation drawer state", () => {
    render(<RoomHeader {...props({ railOpen: true })} />);

    expect(screen.getByRole("button", { name: "room.showChannels" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps the private inbox trigger inside the native toolbar", () => {
    render(
      <RoomHeader
        {...props({ notifications: <button type="button">Inbox</button> })}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "room.channelTools" }))
      .toContainElement(screen.getByRole("button", { name: "Inbox" }));
  });

});
