import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./Switch";

describe("Switch", () => {
  it("is a switch named by its label, and reports the change", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <>
        <label htmlFor="mail">Send mail</label>
        <Switch id="mail" checked={false} onCheckedChange={onCheckedChange} />
      </>,
    );

    const toggle = screen.getByRole("switch", { name: "Send mail" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("data-state", "unchecked");

    await user.click(toggle);

    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
    // Controlled: it waits for the parent to pass the new value.
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("follows the parent's value", async () => {
    const user = userEvent.setup();
    function Owner() {
      const [on, setOn] = useState(false);
      return <Switch aria-label="GIFs" checked={on} onCheckedChange={setOn} />;
    }
    render(<Owner />);

    await user.click(screen.getByRole("switch"));

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch").firstElementChild).toHaveAttribute("data-state", "checked");
  });

  it("does nothing while disabled", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="GIFs" disabled onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole("switch"));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("keeps its own state when the parent leaves it open", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="GIFs" defaultChecked onCheckedChange={onCheckedChange} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("switch"));

    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch").firstElementChild).toHaveAttribute("data-state", "unchecked");
  });

  it("adds the caller's class to its own", () => {
    render(<Switch aria-label="GIFs" className="shrink-0" />);

    expect(screen.getByRole("switch")).toHaveClass("ui-switch", "shrink-0");
  });
});
