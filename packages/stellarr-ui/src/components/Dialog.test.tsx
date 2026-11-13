import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "./Dialog";

function DeleteServer() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel="Close">
          <DialogHeader>
            <DialogTitle>Delete the server?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <a href="/help">What is kept</a>
          <input aria-label="Name" defaultValue="Nook" />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="danger-solid">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("is a dialog named and described by its title and description", async () => {
    const user = userEvent.setup();
    render(<DeleteServer />);

    await user.click(screen.getByRole("button", { name: "Delete…" }));

    const dialog = screen.getByRole("dialog", { name: "Delete the server?" });
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("focuses the first field, not a link, and selects what it holds", async () => {
    const user = userEvent.setup();
    render(<DeleteServer />);

    await user.click(screen.getByRole("button", { name: "Delete…" }));

    const field = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4]);
  });

  it("hides the page from assistive tech while open, and shows it again after", async () => {
    const user = userEvent.setup();
    render(<DeleteServer />);

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Delete…" })).toBeTruthy();
  });

  it("closes on Escape and gives focus back to what opened it", async () => {
    const user = userEvent.setup();
    render(<DeleteServer />);
    const opener = screen.getByRole("button", { name: "Delete…" });

    await user.click(opener);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes from the cross, from a DialogClose and from the backdrop", async () => {
    const user = userEvent.setup();
    render(<DeleteServer />);
    const opener = screen.getByRole("button", { name: "Delete…" });

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(opener);
    fireEvent.pointerDown(document.querySelector(".ui-overlay") as Element);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside, wrapping at both ends", async () => {
    const user = userEvent.setup();
    render(<DeleteServer />);

    await user.click(screen.getByRole("button", { name: "Delete…" }));
    // Name, Cancel, Delete, then the cross, which comes last.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "What is kept" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });
});

describe("Sheet", () => {
  it("opens from its trigger along the asked edge", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button aria-label="Open navigation">≡</Button>
        </SheetTrigger>
        <SheetContent side="left" closeLabel="Close">
          <SheetTitle>Navigation</SheetTitle>
          <a href="/runtime">Runtime</a>
        </SheetContent>
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const sheet = screen.getByRole("dialog", { name: "Navigation" });
    expect(sheet).toHaveClass("ui-sheet");
    expect(sheet).toHaveAttribute("data-side", "left");
    // Only links before the cross, so the cross takes focus.
    expect(within(sheet).getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
