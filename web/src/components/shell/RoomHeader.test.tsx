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
