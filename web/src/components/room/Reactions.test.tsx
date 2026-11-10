import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Reactions } from "./Reactions";

describe("Reactions", () => {
  it("renders a custom reaction as an image and toggles its shortcode", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <Reactions
        reactions={[{ emoji: ":mushris:", count: 2, mine: false }]}
        customEmoji={[
          { id: "e-1", shortcode: ":mushris:", glyph: "/api/emoji/e-1/image" },
        ]}
        onToggle={onToggle}
      />,
    );

    const button = screen.getByRole("button", { name: ":mushris: — 2 reakcji" });
    expect(button.querySelector("img")).toHaveAttribute(
      "src",
      "/api/emoji/e-1/image",
    );
    await user.click(button);
    expect(onToggle).toHaveBeenCalledWith(":mushris:");
  });

  it("leaves Unicode reactions as text", () => {
    render(<Reactions reactions={[{ emoji: "🔥", count: 1, mine: true }]} />);
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
