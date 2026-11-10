import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CollapsibleGroup } from "./CollapsibleGroup";

function Harness({ onToggle }: { onToggle?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <CollapsibleGroup
      id="text-channels"
      caption="Kanały tekstowe"
      open={open}
      onToggle={() => {
        onToggle?.();
        setOpen((value) => !value);
      }}
      actions={<button type="button">Dodaj kanał</button>}
    >
      <button type="button">ogólny</button>
    </CollapsibleGroup>
  );
}

describe("CollapsibleGroup", () => {
  it("opens and closes its body from the caption", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);

    const caption = screen.getByRole("button", { name: /Kanały tekstowe/ });
    const body = document.getElementById("text-channels")!;
    expect(caption).toHaveAttribute("aria-expanded", "true");
    expect(caption).toHaveAttribute("aria-controls", "text-channels");
    expect(screen.getByRole("button", { name: "ogólny" })).toBeVisible();

    await user.click(caption);

    expect(onToggle).toHaveBeenCalledOnce();
    expect(caption).toHaveAttribute("aria-expanded", "false");
    // jsdom does not apply `inert` to the accessibility tree, so the attribute
    // itself is what is checked: it is what removes the rows from the tab order.
    expect(body).toHaveAttribute("inert");

    await user.click(caption);

    expect(caption).toHaveAttribute("aria-expanded", "true");
    expect(body).not.toHaveAttribute("inert");
  });

  it("keeps the actions beside the caption reachable while the body is closed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /Kanały tekstowe/ }));

    expect(screen.getByRole("button", { name: "Dodaj kanał" })).toBeVisible();
  });
});
