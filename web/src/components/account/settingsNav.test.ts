import { describe, expect, it, vi } from "vitest";

import { revealSettingsNavItem } from "./settingsNav";

function setup(
  view: { left: number; right: number },
  tab: { left: number; right: number },
  scrollLeft: number,
) {
  const container = document.createElement("nav");
  const item = document.createElement("button");
  Object.defineProperty(container, "scrollLeft", { value: scrollLeft });
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(view as DOMRect);
  vi.spyOn(item, "getBoundingClientRect").mockReturnValue(tab as DOMRect);
  const scrollTo = vi.fn();
  Object.defineProperty(container, "scrollTo", { value: scrollTo });
  return { container, item, scrollTo };
}

describe("revealSettingsNavItem", () => {
  it("leaves the bar alone when the tab is already visible", () => {
    const { container, item, scrollTo } = setup(
      { left: 0, right: 400 },
      { left: 100, right: 220 },
      50,
    );

    revealSettingsNavItem(container, item);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls back by the part of the tab that hangs off the left edge", () => {
    const { container, item, scrollTo } = setup(
      { left: 40, right: 440 },
      { left: 10, right: 130 },
      200,
    );

    revealSettingsNavItem(container, item);

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 170, behavior: "auto" });
  });

  it("rounds a fractional offset away from the current position", () => {
    const left = setup({ left: 0, right: 400 }, { left: -10.4, right: 90 }, 100);
    revealSettingsNavItem(left.container, left.item);
    expect(left.scrollTo).toHaveBeenCalledWith({ left: 89, behavior: "auto" });

    const right = setup({ left: 0, right: 400 }, { left: 300, right: 410.2 }, 100);
    revealSettingsNavItem(right.container, right.item);
    expect(right.scrollTo).toHaveBeenCalledWith({ left: 111, behavior: "auto" });
  });

  it("does nothing in an environment that cannot scroll an element", () => {
    const container = document.createElement("nav");
    const item = document.createElement("button");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ left: 0, right: 100 } as DOMRect);
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue({ left: 90, right: 160 } as DOMRect);
    Object.defineProperty(container, "scrollTo", { value: undefined });

    expect(() => revealSettingsNavItem(container, item)).not.toThrow();
  });
});
