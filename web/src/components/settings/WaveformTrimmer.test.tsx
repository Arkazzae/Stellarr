import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WaveformTrimmer } from "./WaveformTrimmer";

describe("WaveformTrimmer", () => {
  it("exposes both trim clamps to keyboard users", () => {
    const onChange = vi.fn();
    render(
      <WaveformTrimmer
        duration={8}
        peaks={[0.2, 0.8, 0.4, 1]}
        start={1}
        end={4}
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Początek dźwięku" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith(1.05, 4);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Koniec dźwięku" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenLastCalledWith(1, 3.95);
  });

  it("moves the whole selected fragment without changing its length", () => {
    const onChange = vi.fn();
    const { container } = render(
      <WaveformTrimmer
        duration={10}
        peaks={[0.2, 0.8, 0.4, 1]}
        start={2}
        end={5}
        onChange={onChange}
      />,
    );
    const plot = container.querySelector(".wave-plot") as HTMLDivElement;
    vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 100,
    } as DOMRect);
    const selection = screen.getByRole("slider", { name: "Zaznaczony fragment" });
    selection.setPointerCapture = vi.fn();

    fireEvent.pointerDown(selection, { pointerId: 1, clientX: 30 });
    fireEvent.pointerMove(plot, { pointerId: 1, clientX: 50 });

    expect(onChange).toHaveBeenCalledWith(4, 7);
  });

  it("keeps a moved fragment inside the waveform", () => {
    const onChange = vi.fn();
    render(
      <WaveformTrimmer
        duration={8}
        peaks={[0.2, 0.8, 0.4, 1]}
        start={1}
        end={4}
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Zaznaczony fragment" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenCalledWith(0.95, 3.95);
  });
});
