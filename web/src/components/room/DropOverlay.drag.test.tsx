import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DropOverlay } from "./DropOverlay";

function files(count: number): File[] {
  return Array.from({ length: count }, (_, i) => new File(["x"], `plik-${i}.txt`));
}

function fileDrag(dropped: File[]) {
  return { dataTransfer: { types: ["Files"], files: dropped } };
}

const shown = () => document.querySelector(".drop-overlay.show") !== null;

describe("DropOverlay", () => {
  it("takes at most five files from one drop", () => {
    const onDropFiles = vi.fn();
    render(<DropOverlay channelName="ogólny" onDropFiles={onDropFiles} />);
    const dropped = files(7);

    fireEvent.dragEnter(window, fileDrag(dropped));
    fireEvent.drop(window, fileDrag(dropped));

    expect(onDropFiles).toHaveBeenCalledWith(dropped.slice(0, 5));
    expect(shown()).toBe(false);
  });

  it("ignores a drop that carries no files", () => {
    const onDropFiles = vi.fn();
    render(<DropOverlay channelName="ogólny" onDropFiles={onDropFiles} />);

    fireEvent.dragEnter(window, fileDrag([]));
    fireEvent.drop(window, fileDrag([]));

    expect(onDropFiles).not.toHaveBeenCalled();
    expect(shown()).toBe(false);
  });

  it("ignores a drag of text or links", () => {
    render(<DropOverlay channelName="ogólny" onDropFiles={vi.fn()} />);

    fireEvent.dragEnter(window, { dataTransfer: { types: ["text/plain"], files: [] } });

    expect(shown()).toBe(false);
  });

  it("stays up while the drag crosses elements and goes when it leaves the window", () => {
    render(<DropOverlay channelName="ogólny" onDropFiles={vi.fn()} />);
    const drag = fileDrag(files(1));

    fireEvent.dragEnter(window, drag);
    fireEvent.dragEnter(window, drag);
    fireEvent.dragLeave(window);
    expect(shown()).toBe(true);

    fireEvent.dragLeave(window);
    expect(shown()).toBe(false);
  });

  it("names the channel the file will go to", () => {
    render(<DropOverlay channelName="ogólny" onDropFiles={vi.fn()} />);

    expect(document.querySelector(".drop-card b")).toHaveTextContent(
      "Upuść, aby dodać do #ogólny",
    );
  });

  it("keeps the card up when the parent passes a new handler mid-drag", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <DropOverlay channelName="ogólny" onDropFiles={first} />,
    );
    const dropped = files(1);
    fireEvent.dragEnter(window, fileDrag(dropped));

    rerender(<DropOverlay channelName="ogólny" onDropFiles={second} />);
    expect(shown()).toBe(true);

    fireEvent.drop(window, fileDrag(dropped));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(dropped);
  });

  it("puts the card down when it is disarmed mid-drag", () => {
    const { rerender } = render(
      <DropOverlay channelName="ogólny" onDropFiles={vi.fn()} />,
    );
    fireEvent.dragEnter(window, fileDrag(files(1)));
    expect(shown()).toBe(true);

    rerender(<DropOverlay channelName="ogólny" enabled={false} onDropFiles={vi.fn()} />);

    expect(shown()).toBe(false);
  });

  it("accepts files again once an in-app drag has ended", () => {
    const onDropFiles = vi.fn();
    render(<DropOverlay channelName="ogólny" onDropFiles={onDropFiles} />);
    fireEvent.dragStart(document.body);
    fireEvent.dragEnd(document.body);
    const dropped = files(1);

    fireEvent.dragEnter(window, fileDrag(dropped));
    fireEvent.drop(window, fileDrag(dropped));

    expect(onDropFiles).toHaveBeenCalledWith(dropped);
  });
});
