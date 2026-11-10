import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("is named by its label, since the icon itself says nothing", () => {
    render(<IconButton icon="x" label="Close" title="Close the panel" />);

    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveAttribute("title", "Close the panel");
  });

  it("calls back on click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="x" label="Close" onClick={onClick} />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call back while disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton icon="x" label="Close" onClick={onClick} disabled />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
