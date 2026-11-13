import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Sheet, SheetContent, SheetTitle } from "./Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";

function RowMenu({ onReset = () => {}, onDisable = () => {} }: { onReset?: () => void; onDisable?: () => void }) {
  const [securityOpen, setSecurityOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Actions for Ada">…</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Ada</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setSecurityOpen(true)}>Security</DropdownMenuItem>
          <DropdownMenuItem disabled onSelect={onReset}>
            Reset password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDisable}>
            Disable
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/">Open the app</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet open={securityOpen} onOpenChange={setSecurityOpen}>
        <SheetContent closeLabel="Close">
          <SheetTitle>Ada's security</SheetTitle>
          <input aria-label="Reason" />
        </SheetContent>
      </Sheet>
    </>
  );
}

// While the menu is open the rest of the page, the trigger too, is hidden from assistive tech.
const trigger = () => screen.getByRole("button", { name: "Actions for Ada", hidden: true });

describe("DropdownMenu", () => {
  it("opens a menu of items named by its trigger, with focus on the menu", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger());

    const menu = screen.getByRole("menu", { name: "Actions for Ada" });
    expect(menu).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().closest("[aria-hidden=true]")).not.toBeNull();
    // The label and the separator are not items.
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Security",
      "Reset password",
      "Disable",
      "Open the app",
    ]);
    expect(within(menu).getByRole("menuitem", { name: "Reset password" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Open the app" })).toHaveAttribute("href", "/");
  });

  it("opens from the keyboard on the first item, and the arrows skip what is disabled", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);

    trigger().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Security" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Disable" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Open the app" })).toHaveFocus();

    await user.keyboard("s");
    expect(screen.getByRole("menuitem", { name: "Security" })).toHaveFocus();
  });

  it("runs the picked item, closes and hands focus back to the trigger", async () => {
    const user = userEvent.setup();
    const onDisable = vi.fn();
    render(<RowMenu onDisable={onDisable} />);

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Disable" }));

    expect(onDisable).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("picks with Enter as well", async () => {
    const user = userEvent.setup();
    const onDisable = vi.fn();
    render(<RowMenu onDisable={onDisable} />);

    trigger().focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onDisable).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not run a disabled item", async () => {
    const onReset = vi.fn();
    render(<RowMenu onReset={onReset} />);

    await userEvent.click(trigger());
    screen.getByRole("menuitem", { name: "Reset password" }).click();

    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes on Escape with focus back on the trigger", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("hands a sheet it opens the focus, and gets it back when the sheet closes", async () => {
    const user = userEvent.setup();
    render(<RowMenu />);

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Security" }));

    const sheet = screen.getByRole("dialog", { name: "Ada's security" });
    expect(within(sheet).getByRole("textbox", { name: "Reason" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes only the menu when Escape is pressed in a menu over a sheet", async () => {
    const user = userEvent.setup();
    render(
      <Sheet defaultOpen>
        <SheetContent closeLabel="Close">
          <SheetTitle>Navigation</SheetTitle>
          <DropdownMenu>
            <DropdownMenuTrigger>Account</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account" })).toHaveFocus();
  });
});
