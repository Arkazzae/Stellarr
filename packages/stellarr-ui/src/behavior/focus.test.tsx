import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { focusFirst, trapTab } from "./focus";

function Box() {
  return (
    <div data-testid="box" tabIndex={-1}>
      <a href="/help">Help</a>
      <button disabled>Skipped</button>
      <button>First</button>
      <input aria-label="Name" defaultValue="Nook" />
      <button>Last</button>
    </div>
  );
}

const box = () => screen.getByTestId("box");
const button = (name: string) => screen.getByRole("button", { name });

function pressTab(shiftKey = false, options?: { reclaim?: boolean }) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
  trapTab(event, box(), options);
  return event;
}

describe("focusFirst", () => {
  it("focuses the first tab stop that is not a link, and not a disabled one", () => {
    render(<Box />);

    focusFirst(box());

    expect(button("First")).toHaveFocus();
  });

  it("selects what a field holds, so typing replaces it", () => {
    render(
      <div data-testid="box" tabIndex={-1}>
        <input aria-label="Name" defaultValue="Nook" />
      </div>,
    );

    focusFirst(box());

    const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4]);
  });

  it("focuses the container when it holds nothing but links", () => {
    render(
      <div data-testid="box" tabIndex={-1}>
        <a href="/help">Help</a>
      </div>,
    );

    focusFirst(box());

    expect(box()).toHaveFocus();
  });

  it("does nothing without a container", () => {
    render(<Box />);

    expect(() => focusFirst(null)).not.toThrow();
    expect(document.body).toHaveFocus();
  });
});

describe("trapTab", () => {
  it("wraps Tab from the last stop to the first", () => {
    render(<Box />);
    button("Last").focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first stop to the last", () => {
    render(<Box />);
    screen.getByRole("link", { name: "Help" }).focus();

    const event = pressTab(true);

    expect(event.defaultPrevented).toBe(true);
    expect(button("Last")).toHaveFocus();
  });

  it("sends Shift+Tab from the container to the last stop", () => {
    render(<Box />);
    box().focus();

    const event = pressTab(true);

    expect(event.defaultPrevented).toBe(true);
    expect(button("Last")).toHaveFocus();
  });

  it("brings a Tab from outside the container back to its first stop", () => {
    render(
      <>
        <button>Outside</button>
        <Box />
      </>,
    );
    button("Outside").focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
  });

  it("leaves a Tab from outside the container to the browser when it does not reclaim", () => {
    render(
      <>
        <button>Outside</button>
        <Box />
      </>,
    );
    button("Outside").focus();

    expect(pressTab(false, { reclaim: false }).defaultPrevented).toBe(false);
    expect(pressTab(true, { reclaim: false }).defaultPrevented).toBe(false);
    expect(button("Outside")).toHaveFocus();
  });

  it("still wraps at both ends when it does not reclaim", () => {
    render(<Box />);
    button("Last").focus();

    expect(pressTab(false, { reclaim: false }).defaultPrevented).toBe(true);
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();

    expect(pressTab(true, { reclaim: false }).defaultPrevented).toBe(true);
    expect(button("Last")).toHaveFocus();
  });

  it("leaves a Tab between two stops to the browser", () => {
    render(<Box />);
    button("First").focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(false);
    expect(button("First")).toHaveFocus();
  });

  it("keeps the focus on a container that has no stops", () => {
    render(<div data-testid="box" tabIndex={-1} />);

    const event = pressTab();

    expect(event.defaultPrevented).toBe(true);
    expect(box()).toHaveFocus();
  });
});
