import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePresence } from "./presence";

function Fading({ open }: { open: boolean }) {
  const { present, ref } = usePresence<HTMLDivElement>(open);
  return present ? <div ref={ref} data-testid="part" data-state={open ? "open" : "closed"} /> : null;
}

/** jsdom applies no stylesheet; this one says the closed part animates. */
function animateClosed() {
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    const name = element.getAttribute("data-state") === "closed" ? "ui-fade-out" : "none";
    return new Proxy(style, {
      get: (target, key) => (key === "animationName" ? name : Reflect.get(target, key, target)),
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("usePresence", () => {
  it("leaves at once when the closed state animates nothing", () => {
    const { rerender } = render(<Fading open />);

    rerender(<Fading open={false} />);

    expect(screen.queryByTestId("part")).toBeNull();
  });

  it("stays, marked closed, until its exit animation ends", () => {
    animateClosed();
    const { rerender } = render(<Fading open />);

    rerender(<Fading open={false} />);
    expect(screen.getByTestId("part")).toHaveAttribute("data-state", "closed");

    fireEvent.animationEnd(screen.getByTestId("part"));
    expect(screen.queryByTestId("part")).toBeNull();
  });

  it("comes back open if it is reopened during the exit", () => {
    animateClosed();
    const { rerender } = render(<Fading open />);

    rerender(<Fading open={false} />);
    rerender(<Fading open />);

    expect(screen.getByTestId("part")).toHaveAttribute("data-state", "open");
    fireEvent.animationEnd(screen.getByTestId("part"));
    expect(screen.getByTestId("part")).toBeTruthy();
  });

  it("leaves after a while even if the animation never reports its end", () => {
    vi.useFakeTimers();
    animateClosed();
    const { rerender } = render(<Fading open />);

    rerender(<Fading open={false} />);
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.queryByTestId("part")).toBeNull();
  });
});
