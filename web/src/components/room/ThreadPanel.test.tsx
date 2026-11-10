import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadPanel } from "./ThreadPanel";

describe("ThreadPanel width control", () => {
  it("expands across the room and can be restored", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <ThreadPanel
        open
        expanded={false}
        onExpandedChange={onExpandedChange}
        onClose={vi.fn()}
        sections={[]}
        label="Wątek"
        composer={<textarea aria-label="Napisz we wątku" />}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Napisz we wątku" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Rozszerz wątek na cały środek" }),
    );
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    rerender(
      <ThreadPanel
        open
        expanded
        onExpandedChange={onExpandedChange}
        onClose={vi.fn()}
        sections={[]}
        label="Wątek"
      />,
    );
    expect(screen.getByRole("button", { name: "Przywróć panel wątku" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
