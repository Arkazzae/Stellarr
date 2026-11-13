import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hideOthers, lockPointer, lockScroll, useLayer, type Layer } from "./layers";

type Handlers = Pick<Layer, "onEscape" | "onTab" | "onPointerDownOutside">;

/** A layer that is on the stack while `active`, with the handlers it is given. */
function Probe({ name, active = true, ...handlers }: { name: string; active?: boolean } & Handlers) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(active, { node: () => ref.current, ...handlers });
  return <div ref={ref} data-testid={name} />;
}

/** Two layers, the second above the first; the one above can leave. */
function Stack({ below, above }: { below: Handlers; above?: Handlers }) {
  return (
    <>
      <Probe name="below" {...below} />
      {above && <Probe name="above" {...above} />}
    </>
  );
}

/** Undoes whatever a test left in place, once, so a failing test does not poison the next. */
const undos: Array<() => void> = [];

function track(undo: () => void) {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    undo();
  };
  undos.push(once);
  return once;
}

function addToBody(id: string) {
  const element = document.createElement("div");
  element.id = id;
  document.body.append(element);
  undos.push(() => element.remove());
  return element;
}

afterEach(() => {
  for (const undo of undos.splice(0).reverse()) undo();
  document.body.removeAttribute("style");
});

describe("useLayer", () => {
  it("sends Escape to the topmost layer that handles it, and to no other", async () => {
    const user = userEvent.setup();
    const below = vi.fn();
    const above = vi.fn();
    render(<Stack below={{ onEscape: below }} above={{ onEscape: above }} />);

    await user.keyboard("{Escape}");

    expect(above).toHaveBeenCalledOnce();
    expect(below).not.toHaveBeenCalled();
  });

  it("passes over a layer that has no handler for the key", async () => {
    const user = userEvent.setup();
    const below = vi.fn();
    render(<Stack below={{ onEscape: below }} above={{}} />);

    await user.keyboard("{Escape}");

    expect(below).toHaveBeenCalledOnce();
  });

  it("keeps an Escape it handles from the page's own handlers, and lets the other keys through", async () => {
    const user = userEvent.setup();
    const page = vi.fn();
    window.addEventListener("keydown", page);
    undos.push(() => window.removeEventListener("keydown", page));
    const { unmount } = render(<Probe name="only" onEscape={() => {}} />);

    await user.keyboard("{Escape}");
    expect(page).not.toHaveBeenCalled();

    await user.keyboard("a");
    expect(page).toHaveBeenCalledOnce();

    unmount();
    await user.keyboard("{Escape}");
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("sends Tab to the topmost layer that handles it", async () => {
    const user = userEvent.setup();
    const below = vi.fn();
    const above = vi.fn();
    render(<Stack below={{ onTab: below }} above={{ onTab: above }} />);

    await user.keyboard("{Tab}");

    expect(above).toHaveBeenCalledOnce();
    expect(below).not.toHaveBeenCalled();
  });

  it("sends a press outside to the topmost layer only", () => {
    const below = vi.fn();
    const above = vi.fn();
    render(<Stack below={{ onPointerDownOutside: below }} above={{ onPointerDownOutside: above }} />);

    fireEvent.pointerDown(document.body);

    expect(above).toHaveBeenCalledOnce();
    expect(below).not.toHaveBeenCalled();
  });

  it("does not call a layer for a press inside its own element", () => {
    const above = vi.fn();
    render(<Probe name="above" onPointerDownOutside={above} />);

    fireEvent.pointerDown(screen.getByTestId("above"));

    expect(above).not.toHaveBeenCalled();
  });

  it("counts a press inside a layer beneath as outside the topmost one", () => {
    const below = vi.fn();
    const above = vi.fn();
    render(<Stack below={{ onPointerDownOutside: below }} above={{ onPointerDownOutside: above }} />);

    fireEvent.pointerDown(screen.getByTestId("below"));

    expect(above).toHaveBeenCalledOnce();
    expect(below).not.toHaveBeenCalled();
  });

  it("takes its layer off the stack when it unmounts, so the one beneath is heard again", async () => {
    const user = userEvent.setup();
    const below = vi.fn();
    const above = vi.fn();
    const { rerender } = render(<Stack below={{ onEscape: below }} above={{ onEscape: above }} />);

    rerender(<Stack below={{ onEscape: below }} />);
    await user.keyboard("{Escape}");

    expect(below).toHaveBeenCalledOnce();
    expect(above).not.toHaveBeenCalled();
  });

  it("is on the stack only while it is active", async () => {
    const user = userEvent.setup();
    const escape = vi.fn();
    const { rerender } = render(<Probe name="only" active={false} onEscape={escape} />);

    await user.keyboard("{Escape}");
    expect(escape).not.toHaveBeenCalled();

    rerender(<Probe name="only" onEscape={escape} />);
    await user.keyboard("{Escape}");
    expect(escape).toHaveBeenCalledOnce();

    rerender(<Probe name="only" active={false} onEscape={escape} />);
    await user.keyboard("{Escape}");
    expect(escape).toHaveBeenCalledOnce();
  });

  it("calls the handlers of the latest render", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Probe name="only" onEscape={first} />);

    rerender(<Probe name="only" onEscape={second} />);
    await user.keyboard("{Escape}");

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});

describe("hideOthers", () => {
  it("hides what is beside the layer and shows it again on undo", () => {
    const layer = addToBody("layer");
    const page = addToBody("page");

    const undo = track(hideOthers([layer]));
    expect(page).toHaveAttribute("aria-hidden", "true");
    expect(layer).not.toHaveAttribute("aria-hidden");

    undo();
    expect(page).not.toHaveAttribute("aria-hidden");
  });

  it("does not hide what holds the layer, and ignores a layer that is not there", () => {
    const wrapper = addToBody("wrapper");
    const inner = document.createElement("div");
    wrapper.append(inner);
    const page = addToBody("page");

    track(hideOthers([inner, null]));

    expect(wrapper).not.toHaveAttribute("aria-hidden");
    expect(page).toHaveAttribute("aria-hidden", "true");
  });

  it("shows an element again only when every layer that hid it is gone", () => {
    const first = addToBody("first");
    const second = addToBody("second");
    const page = addToBody("page");
    const undoFirst = track(hideOthers([first]));
    const undoSecond = track(hideOthers([second]));
    expect(page).toHaveAttribute("aria-hidden", "true");

    undoFirst();
    expect(page).toHaveAttribute("aria-hidden", "true");

    undoSecond();
    expect(page).not.toHaveAttribute("aria-hidden");
  });

  it("leaves live regions alone", () => {
    const layer = addToBody("layer");
    const status = addToBody("status");
    status.setAttribute("aria-live", "polite");

    track(hideOthers([layer]));

    expect(status).not.toHaveAttribute("aria-hidden");
  });

  it("leaves what was already hidden hidden, also after the undo", () => {
    const layer = addToBody("layer");
    const page = addToBody("page");
    page.setAttribute("aria-hidden", "true");

    const undo = track(hideOthers([layer]));
    undo();

    expect(page).toHaveAttribute("aria-hidden", "true");
  });
});

describe("lockScroll", () => {
  /** Turns the wheel over `target`; true when something kept the page from scrolling. */
  const wheelOver = (target: Element) =>
    !target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true }));

  it("keeps the page from scrolling and gives the scroll back on undo", () => {
    document.body.style.overflow = "auto";
    const page = addToBody("page");

    const undo = track(lockScroll(() => []));
    expect(document.body.style.overflow).toBe("hidden");
    expect(wheelOver(page)).toBe(true);

    undo();
    expect(document.body.style.overflow).toBe("auto");
    expect(wheelOver(page)).toBe(false);
  });

  it("lets the layer's own areas scroll", () => {
    const area = addToBody("area");
    const inside = document.createElement("div");
    area.append(inside);
    const page = addToBody("page");

    track(lockScroll(() => [area]));

    expect(wheelOver(inside)).toBe(false);
    expect(wheelOver(page)).toBe(true);
  });

  it("holds until every lock is undone, and then restores what the page had", () => {
    document.body.style.overflow = "auto";
    const first = addToBody("first");
    const second = addToBody("second");
    const undoFirst = track(lockScroll(() => [first]));
    const undoSecond = track(lockScroll(() => [second]));
    expect(wheelOver(first)).toBe(false);
    expect(wheelOver(second)).toBe(false);

    undoFirst();
    expect(document.body.style.overflow).toBe("hidden");
    expect(wheelOver(first)).toBe(true);
    expect(wheelOver(second)).toBe(false);

    undoSecond();
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("lockPointer", () => {
  it("makes the page ignore the pointer and gives it back on undo", () => {
    document.body.style.pointerEvents = "auto";

    const undo = track(lockPointer());
    expect(document.body.style.pointerEvents).toBe("none");

    undo();
    expect(document.body.style.pointerEvents).toBe("auto");
  });

  it("holds until every lock is undone", () => {
    const undoFirst = track(lockPointer());
    const undoSecond = track(lockPointer());

    undoFirst();
    expect(document.body.style.pointerEvents).toBe("none");

    undoSecond();
    expect(document.body.style.pointerEvents).toBe("");
  });
});
