import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WaveformTrimmer, type WaveformTrimmerProps } from "./WaveformTrimmer";

const PEAKS = [0.2, 0.8, 0.4, 1];

function renderTrimmer(overrides: Partial<WaveformTrimmerProps> = {}) {
  const onChange = vi.fn();
  const result = render(
    <WaveformTrimmer
      duration={10}
      peaks={PEAKS}
      start={1}
      end={6}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange, ...result };
}

describe("WaveformTrimmer limits", () => {
  it("never lets the handles come closer than the shortest clip", () => {
    const { onChange } = renderTrimmer({ start: 3.9, end: 4 });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Początek dźwięku" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenLastCalledWith(3.85, 4);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Koniec dźwięku" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenLastCalledWith(3.9, 4.05);
  });

  it("never lets a clip grow past fifteen seconds", () => {
    const { onChange } = renderTrimmer({ duration: 30, start: 5, end: 20 });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Początek dźwięku" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenLastCalledWith(5, 20);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Koniec dźwięku" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenLastCalledWith(5, 20);
  });

  it("stops the selected fragment at the end of the sound", () => {
    const { onChange } = renderTrimmer({ duration: 8, start: 5, end: 8 });

    fireEvent.keyDown(screen.getByRole("slider", { name: "Zaznaczony fragment" }), {
      key: "ArrowRight",
    });

    expect(onChange).toHaveBeenCalledWith(5, 8);
  });

  it("drags a handle to where the pointer is, until the pointer is released", () => {
    const { onChange, container } = renderTrimmer();
    const plot = container.querySelector(".wave-plot") as HTMLDivElement;
    vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
    const handle = screen.getByRole("slider", { name: "Początek dźwięku" });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 30 });
    expect(onChange).toHaveBeenLastCalledWith(3, 6);

    fireEvent.pointerMove(plot, { pointerId: 1, clientX: 50 });
    expect(onChange).toHaveBeenLastCalledWith(5, 6);

    fireEvent.pointerUp(plot, { pointerId: 1 });
    onChange.mockClear();
    fireEvent.pointerMove(plot, { pointerId: 1, clientX: 70 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores pointer and keyboard input while disabled", () => {
    const { onChange } = renderTrimmer({ disabled: true });
    const handle = screen.getByRole("slider", { name: "Koniec dźwięku" });
    handle.setPointerCapture = vi.fn();

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10 });

    expect(onChange).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute("tabindex", "-1");
  });

  it("reads the trim points out as times", () => {
    renderTrimmer({ duration: 120, start: 61.5, end: 63 });

    expect(screen.getByText("1:01.50")).toBeInTheDocument();
    expect(screen.getByText("1:03.00")).toBeInTheDocument();
    expect(screen.getByText("1.50 s")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Zaznaczony fragment" })).toHaveAttribute(
      "aria-valuetext",
      "1:01.50–1:03.00",
    );
  });
});
