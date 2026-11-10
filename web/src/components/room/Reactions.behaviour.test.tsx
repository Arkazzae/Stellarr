import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Reaction } from "@/ports";

import { Reactions } from "./Reactions";

const fire: Reaction = { emoji: "🔥", count: 1, mine: false };

describe("Reactions", () => {
  it("renders nothing when a message has no reactions", () => {
    const { container } = render(<Reactions reactions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows which reactions are yours", () => {
    render(
      <Reactions
        reactions={[fire, { emoji: "👍", count: 3, mine: true }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "🔥 — 1 reakcji" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "👍 — 3 reakcji" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles the emoji that was clicked", async () => {
    const onToggle = vi.fn();
    render(<Reactions reactions={[fire]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "🔥 — 1 reakcji" }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("🔥");
  });

  it("does not toggle while disabled", async () => {
    const onToggle = vi.fn();
    render(<Reactions reactions={[fire]} onToggle={onToggle} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "🔥 — 1 reakcji" }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("matches a custom emoji whether or not the stored shortcode has colons", () => {
    render(
      <Reactions
        reactions={[{ emoji: "pepe", count: 1, mine: false }]}
        customEmoji={[{ id: "e-2", shortcode: ":pepe:", glyph: "/api/emoji/e-2/image" }]}
      />,
    );
    expect(screen.getByRole("img", { name: "pepe" })).toHaveAttribute(
      "src",
      "/api/emoji/e-2/image",
    );
  });

  describe("when a count changes", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("animates only the chip that changed, and only briefly", () => {
      const other: Reaction = { emoji: "👍", count: 2, mine: false };
      const { rerender } = render(<Reactions reactions={[fire, other]} />);
      const chip = (name: string) => screen.getByRole("button", { name });

      // What was on screen at mount stays still.
      expect(chip("🔥 — 1 reakcji")).not.toHaveClass("pop");

      rerender(<Reactions reactions={[{ ...fire, count: 2 }, other]} />);
      expect(chip("🔥 — 2 reakcji")).toHaveClass("pop");
      expect(chip("👍 — 2 reakcji")).not.toHaveClass("pop");

      act(() => {
        vi.advanceTimersByTime(240);
      });
      expect(chip("🔥 — 2 reakcji")).not.toHaveClass("pop");
    });
  });
});
