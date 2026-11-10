import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ComposerChips, type ComposerChip } from "./ComposerChips";

const chips: ComposerChip[] = [
  { id: "a", name: "notes.pdf", status: "ready" },
  { id: "b", name: "clip.mp4", status: "uploading" },
  { id: "c", name: "photo.png", status: "ready" },
];

function setup(list = chips) {
  const handlers = { onRemove: vi.fn(), onRetry: vi.fn(), onReorder: vi.fn() };
  render(<ComposerChips chips={list} {...handlers} />);
  const pills = () => Array.from(document.querySelectorAll<HTMLElement>(".chip"));
  return { ...handlers, pills };
}

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });

describe("ComposerChips", () => {
  it("says which uploads are still running and which failed", () => {
    setup([
      chips[1]!,
      { id: "d", name: "big.zip", status: "error", error: "Za duży plik" },
      { id: "e", name: "odd.bin", status: "error" },
    ]);

    expect(screen.getByRole("status")).toHaveTextContent("Przesyłanie");
    const failures = screen.getAllByRole("alert");
    expect(failures[0]).toHaveTextContent("Za duży plik");
    expect(failures[1]).toHaveTextContent("Nie udało się przesłać");
  });

  it("removes a chip by name", async () => {
    const { onRemove } = setup();

    await userEvent.setup().click(screen.getByRole("button", { name: "Usuń clip.mp4" }));

    expect(onRemove).toHaveBeenCalledWith("b");
  });

  it("moves a chip to where it is dropped", () => {
    const { pills, onReorder } = setup();
    const transfer = dataTransfer();

    fireEvent.dragStart(pills()[0]!, { dataTransfer: transfer });
    expect(pills()[0]).toHaveClass("drag-chosen");

    fireEvent.dragOver(pills()[2]!, { dataTransfer: transfer });
    expect(pills()[2]).toHaveClass("drag-ghost");

    fireEvent.drop(pills()[2]!, { dataTransfer: transfer });
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(pills()[0]).not.toHaveClass("drag-chosen");
    expect(pills()[2]).not.toHaveClass("drag-ghost");
  });

  it("does nothing when a chip is dropped on itself", () => {
    const { pills, onReorder } = setup();
    const transfer = dataTransfer();

    fireEvent.dragStart(pills()[1]!, { dataTransfer: transfer });
    fireEvent.drop(pills()[1]!, { dataTransfer: transfer });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("leaves a file dragged in from outside to the drop overlay", () => {
    const { pills, onReorder } = setup();
    const transfer = dataTransfer();

    // Nothing was picked up here, so the events must stay unhandled and bubble.
    const overAccepted = fireEvent.dragOver(pills()[0]!, { dataTransfer: transfer });
    const dropAccepted = fireEvent.drop(pills()[0]!, { dataTransfer: transfer });

    expect(overAccepted).toBe(true);
    expect(dropAccepted).toBe(true);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("drops the highlight when a drag is abandoned", () => {
    const { pills } = setup();
    const transfer = dataTransfer();

    fireEvent.dragStart(pills()[0]!, { dataTransfer: transfer });
    fireEvent.dragEnd(pills()[0]!, { dataTransfer: transfer });

    expect(pills()[0]).not.toHaveClass("drag-chosen");
  });
});
