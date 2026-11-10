import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell, type AppShellProps } from "./AppShell";

const baseProps: AppShellProps = {
  serverRail: <button>Serwery</button>,
  rail: <button>Kanały</button>,
  room: <button>Pokój</button>,
  roster: <button>Użytkownicy</button>,
  railOpen: false,
  onRailOpenChange: vi.fn(),
  serversOpen: false,
  rosterOpen: false,
  onRosterOpenChange: vi.fn(),
};

function tabEvent() {
  return new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
}

describe("AppShell keyboard behaviour", () => {
  it("stops browser Tab navigation in the signed-in interface", () => {
    render(<AppShell {...baseProps} />);

    const event = tabEvent();
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Tab handling to an open modal", () => {
    render(
      <>
        <AppShell {...baseProps} />
        <div role="dialog" aria-modal="true" aria-label="Ustawienia" />
      </>,
    );

    const event = tabEvent();
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
