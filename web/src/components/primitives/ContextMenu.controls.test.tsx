import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu, useContextMenu, type MenuEntry } from "./ContextMenu";

const AT = { x: 40, y: 40 };

function actions(...ids: string[]) {
  const onSelect = vi.fn();
  const entries: MenuEntry[] = ids.map((id) => ({ id, label: id, onSelect }));
  return { entries, onSelect };
}

describe("ContextMenu controls", () => {
  it("puts focus on the first control and keeps the actions in a menu of their own", () => {
    const { entries } = actions("Profile");
    render(
      <ContextMenu
        at={AT}
        label="Maja"
        onClose={vi.fn()}
        entries={entries}
        controls={<input type="range" aria-label="Volume" />}
      />,
    );

    expect(screen.getByRole("slider", { name: "Volume" })).toHaveFocus();
    expect(screen.getByRole("menu", { name: "Maja" })).toContainElement(
      screen.getByRole("menuitem", { name: "Profile" }),
    );
  });

  it("is a dialog when there is nothing but controls", () => {
    render(
      <ContextMenu
        at={AT}
        label="Maja"
        onClose={vi.fn()}
        entries={[]}
        controls={<input type="range" aria-label="Volume" />}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Maja" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves the arrows and Enter to a range instead of steering the actions", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { entries, onSelect } = actions("Profile", "Mute");
    render(
      <ContextMenu
        at={AT}
        label="Maja"
        onClose={onClose}
        entries={entries}
        controls={<input type="range" aria-label="Volume" />}
      />,
    );

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ContextMenu keyboard and dismissal", () => {
  it("wraps the cursor from the last item to the first", async () => {
    const user = userEvent.setup();
    const { entries, onSelect } = actions("one", "two");
    render(<ContextMenu at={AT} label="Message" onClose={vi.fn()} entries={entries} />);

    await user.keyboard("{ArrowUp}{ArrowDown}{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole("menuitem", { name: "one" })).toBeInTheDocument();
  });

  it("closes on a press outside, on any scroll and on resize, not on a press inside", () => {
    const onClose = vi.fn();
    const { entries } = actions("one");
    render(<ContextMenu at={AT} label="Message" onClose={onClose} entries={entries} />);
    const menu = screen.getByRole("menu", { name: "Message" });

    fireEvent.pointerDown(menu);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.scroll(menu);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});

function Surface({ onSelect }: { onSelect: () => void }) {
  const menu = useContextMenu();
  return (
    <>
      <p onContextMenu={menu.onContextMenu}>Row</p>
      {menu.at === null ? null : (
        <ContextMenu
          at={menu.at}
          label="Row"
          onClose={menu.close}
          entries={[{ id: "a", label: "Open", onSelect }]}
        />
      )}
    </>
  );
}

describe("useContextMenu", () => {
  it("replaces the browser menu on right-click and closes behind a choice", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Surface onSelect={onSelect} />);

    const prevented = !fireEvent.contextMenu(screen.getByText("Row"), {
      clientX: 12,
      clientY: 20,
    });
    expect(prevented).toBe(true);

    await user.click(screen.getByRole("menuitem", { name: "Open" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves the browser menu reachable with Shift", () => {
    render(<Surface onSelect={vi.fn()} />);

    const prevented = !fireEvent.contextMenu(screen.getByText("Row"), { shiftKey: true });

    expect(prevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("takes focus back when its owner re-renders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Surface onSelect={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("Row"), { clientX: 12, clientY: 20 });
    expect(screen.getByRole("menu", { name: "Row" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();

    rerender(<Surface onSelect={vi.fn()} />);

    expect(screen.getByRole("menu", { name: "Row" })).toHaveFocus();
  });
});
