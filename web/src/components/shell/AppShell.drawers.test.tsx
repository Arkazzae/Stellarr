import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell, type AppShellProps } from "./AppShell";

function setup(overrides: Partial<AppShellProps> = {}) {
  const props: AppShellProps = {
    serverRail: <nav>Serwery</nav>,
    rail: <nav>Kanały</nav>,
    room: <main>Pokój</main>,
    roster: <aside>Użytkownicy</aside>,
    railOpen: false,
    onRailOpenChange: vi.fn(),
    rosterOpen: false,
    onRosterOpenChange: vi.fn(),
    ...overrides,
  };
  const { container } = render(<AppShell {...props} />);
  const scrim = () => container.querySelector(".scrim");
  return { props, container, scrim };
}

const escape = () => fireEvent.keyDown(window, { key: "Escape" });

// The matchMedia stub in vitest.setup answers from innerWidth and never fires
// change events, so a test picks its breakpoint before rendering.
const originalWidth = window.innerWidth;
function viewport(width: number) {
  window.innerWidth = width;
}

beforeEach(() => viewport(1400));
afterEach(() => viewport(originalWidth));

describe("AppShell below 768px", () => {
  beforeEach(() => viewport(600));

  it("dims the room while the rail drawer is open", () => {
    expect(setup({ railOpen: true }).scrim()).toHaveClass("show");
    expect(setup({ railOpen: false }).scrim()).not.toHaveClass("show");
  });

  it("closes both drawers on Escape", () => {
    const { props } = setup({ railOpen: true, rosterOpen: true });

    escape();

    expect(props.onRailOpenChange).toHaveBeenCalledWith(false);
    expect(props.onRosterOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes both drawers when the scrim is pressed", async () => {
    const user = userEvent.setup();
    const { props, scrim } = setup({ railOpen: true, rosterOpen: true });

    await user.click(scrim()!);

    expect(props.onRailOpenChange).toHaveBeenCalledWith(false);
    expect(props.onRosterOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("AppShell between 768px and 1023px", () => {
  beforeEach(() => viewport(900));

  it("treats only the roster as a drawer", () => {
    expect(setup({ railOpen: true }).scrim()).not.toHaveClass("show");
    expect(setup({ rosterOpen: true }).scrim()).toHaveClass("show");
  });
});

describe("AppShell from 1024px", () => {
  it("never dims the room for the roster, and Escape leaves it open", () => {
    const { props, scrim } = setup({ rosterOpen: true });

    escape();

    expect(scrim()).not.toHaveClass("show");
    expect(props.onRosterOpenChange).not.toHaveBeenCalled();
  });
});

describe("AppShell stage", () => {
  it("leaves full screen on Escape only while it is full", () => {
    const onExitStageFull = vi.fn();

    setup({ onExitStageFull });
    escape();
    expect(onExitStageFull).not.toHaveBeenCalled();

    setup({ stageFull: true, onExitStageFull });
    escape();
    expect(onExitStageFull).toHaveBeenCalled();
  });
});

describe("AppShell context menu", () => {
  it("suppresses the browser's menu over the shell but not over a field", () => {
    const { container } = setup({
      serverRail: <button>Serwery</button>,
      rail: <input aria-label="Szukaj" />,
    });

    const onButton = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.querySelector("button")!.dispatchEvent(onButton);
    const onField = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.querySelector("input")!.dispatchEvent(onField);

    expect(onButton.defaultPrevented).toBe(true);
    expect(onField.defaultPrevented).toBe(false);
  });
});
