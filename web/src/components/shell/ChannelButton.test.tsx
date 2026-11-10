import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChannelButton,
  type ChannelDragProps,
} from "./ChannelButton";

describe("ChannelButton interaction structure", () => {
  it("renders selection, thread disclosure and settings as sibling buttons", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggleThreads = vi.fn();
    const onOpenSettings = vi.fn();
    const { container } = render(
      <ChannelButton
        kind="text"
        name="ogólny"
        active
        threadCount={2}
        threadsId="threads-ogolny"
        onToggleThreads={onToggleThreads}
        onOpenSettings={onOpenSettings}
        onSelect={onSelect}
      />,
    );

    const row = container.querySelector<HTMLElement>(".channel");
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe("DIV");
    expect(row?.querySelector("button button")).toBeNull();

    const main = within(row!).getByRole("button", { name: "ogólny" });
    const threads = within(row!).getByRole("button", {
      name: "Pokaż wątki kanału ogólny",
    });
    const settings = within(row!).getByRole("button", {
      name: "Ustawienia kanału: ogólny",
    });

    expect(main).toHaveAttribute("aria-current", "page");
    expect(threads).toHaveAttribute("aria-controls", "threads-ogolny");

    await user.click(threads);
    expect(onToggleThreads).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(settings);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(main);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("keeps Enter for selection and Space for sortable keyboard input", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenSettings = vi.fn();
    const dragKeyDown = vi.fn();
    const dragPointerDown = vi.fn();
    const setNode = vi.fn();
    const drag: ChannelDragProps = {
      setNode,
      style: {},
      dragging: false,
      attributes: {} as ChannelDragProps["attributes"],
      listeners: {
        onKeyDown: dragKeyDown,
        onPointerDown: dragPointerDown,
      } as ChannelDragProps["listeners"],
    };

    const { container } = render(
      <ChannelButton
        kind="text"
        name="ogólny"
        onOpenSettings={onOpenSettings}
        onSelect={onSelect}
        drag={drag}
      />,
    );

    const row = container.querySelector<HTMLElement>(".channel");
    const main = screen.getByRole("button", { name: "ogólny" });
    const settings = screen.getByRole("button", {
      name: "Ustawienia kanału: ogólny",
    });

    expect(setNode).toHaveBeenCalledWith(row);
    expect(row).not.toHaveAttribute("role");

    fireEvent.keyDown(main, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(dragKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(main, { key: " " });
    expect(dragKeyDown).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();

    await user.click(settings);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(dragPointerDown).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
