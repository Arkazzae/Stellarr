import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SortableChannel } from "./SortableChannel";

describe("SortableChannel", () => {
  it("lets the keyboard pick the row up with Space and still follows it with Enter", () => {
    const onSelect = vi.fn();
    const onDragStart = vi.fn();
    render(
      <DndContext onDragStart={onDragStart}>
        <SortableContext items={["c1"]}>
          <SortableChannel id="c1" kind="text" name="ogólny" onSelect={onSelect} />
        </SortableContext>
      </DndContext>,
    );

    const main = screen.getByRole("button", { name: "ogólny" });
    fireEvent.keyDown(main, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onDragStart).not.toHaveBeenCalled();

    fireEvent.keyDown(main, { key: " ", code: "Space" });
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragStart.mock.calls[0]?.[0].active.id).toBe("c1");
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
