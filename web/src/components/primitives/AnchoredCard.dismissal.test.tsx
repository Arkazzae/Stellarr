import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnchoredCard } from "./AnchoredCard";

function Harness({
  onClose,
  autoFocus,
}: {
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={(event) => setAnchor(anchor === null ? event.currentTarget : null)}
      >
        Maja
      </button>
      <button type="button">Elsewhere</button>
      {anchor === null ? null : (
        <AnchoredCard
          anchor={anchor}
          label="Profile"
          autoFocus={autoFocus}
          onClose={() => {
            onClose?.();
            setAnchor(null);
          }}
        >
          <input aria-label="Note" />
          <button type="button">Message</button>
        </AnchoredCard>
      )}
    </>
  );
}

const card = () => screen.queryByRole("dialog", { name: "Profile" });

describe("AnchoredCard", () => {
  it("moves focus into the card and gives it back to the anchor on closing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const anchor = screen.getByRole("button", { name: "Maja" });

    await user.click(anchor);
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(card()).toBeNull();
    expect(anchor).toHaveFocus();
  });

  it("leaves focus alone when asked not to take it", async () => {
    const user = userEvent.setup();
    render(<Harness autoFocus={false} />);

    await user.click(screen.getByRole("button", { name: "Maja" }));

    expect(card()).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Note" })).not.toHaveFocus();
  });

  it("closes on Escape without letting a window listener act on it", async () => {
    const user = userEvent.setup();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "Maja" }));
      onWindowKey.mockClear();

      await user.keyboard("{Escape}");

      expect(card()).toBeNull();
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("keeps Tab and Shift+Tab inside the card", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Maja" }));

    await user.tab();
    expect(screen.getByRole("button", { name: "Message" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Message" })).toHaveFocus();
  });

  it("closes on a press elsewhere, but not inside the card or on the anchor", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Maja" }));

    await user.click(screen.getByRole("button", { name: "Message" }));
    expect(onClose).not.toHaveBeenCalled();

    // The anchor toggles the card itself. If the press closed it as well, the
    // click that follows would open it again.
    await user.click(screen.getByRole("button", { name: "Maja" }));
    expect(card()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Maja" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(card()).toBeNull();
  });

  it("closes at once when its anchor is no longer on the page", () => {
    const onClose = vi.fn();
    const detached = document.createElement("button");

    render(
      <AnchoredCard anchor={detached} label="Profile" onClose={onClose}>
        <p>Gone</p>
      </AnchoredCard>,
    );

    expect(onClose).toHaveBeenCalled();
  });
});
