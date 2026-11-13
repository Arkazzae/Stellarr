import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";

function Info() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label="What a backup holds">i</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        The database, files and keys.
      </TooltipContent>
    </Tooltip>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("opens at once on keyboard focus and describes the trigger", async () => {
    const user = userEvent.setup();
    render(<Info />);

    await user.tab();

    const note = screen.getByRole("tooltip");
    expect(note.textContent).toBe("The database, files and keys.");
    expect(screen.getByRole("button")).toHaveAccessibleDescription("The database, files and keys.");

    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens for a resting pointer only after the delay", () => {
    vi.useFakeTimers();
    render(<Info />);

    fireEvent.pointerEnter(screen.getByRole("button"), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.pointerLeave(screen.getByRole("button"), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open from the focus a press brings", () => {
    render(<Info />);
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button);
    act(() => button.focus());

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Info />);

    await user.tab();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
