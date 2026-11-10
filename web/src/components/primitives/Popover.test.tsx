import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Popover } from "./Popover";

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Elsewhere</button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        renderTrigger={(props) => (
          <button {...props} type="button">
            Account
          </button>
        )}
      >
        <button type="button">Sign out</button>
      </Popover>
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "Account" });
const panelButton = () => screen.getByRole("button", { name: "Sign out", hidden: true });

describe("Popover", () => {
  it("hides the panel until the trigger is pressed and says so on the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(panelButton()).not.toBeVisible();

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(panelButton()).toBeVisible();
  });

  it("closes on a click outside, but not on one inside the panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    await user.click(panelButton());
    expect(panelButton()).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(panelButton()).not.toBeVisible();
  });

  it("reports one change when the trigger closes it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await user.click(trigger());
    onOpenChange.mockClear();

    await user.click(trigger());

    expect(onOpenChange).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape, returns focus to the trigger and keeps the key from the window", async () => {
    const user = userEvent.setup();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      render(<Harness />);
      await user.click(trigger());
      await user.click(panelButton());
      onWindowKey.mockClear();

      await user.keyboard("{Escape}");

      expect(panelButton()).not.toBeVisible();
      expect(trigger()).toHaveFocus();
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("ignores Escape and outside clicks while closed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
