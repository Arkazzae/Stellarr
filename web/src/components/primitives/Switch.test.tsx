import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./Switch";

describe("Switch", () => {
  it("is named by its label and reports its state", () => {
    const { rerender } = render(<Switch checked={false} onChange={vi.fn()} label="Mute" />);
    expect(screen.getByRole("button", { name: "Mute", pressed: false })).toBeInTheDocument();

    rerender(<Switch checked onChange={vi.fn()} label="Mute" />);
    expect(screen.getByRole("button", { name: "Mute", pressed: true })).toBeInTheDocument();
  });

  it("asks for the opposite of the current state when pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Mute" />);

    await user.click(screen.getByRole("button", { name: "Mute" }));

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does nothing while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Mute" disabled />);

    await user.click(screen.getByRole("button", { name: "Mute" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
