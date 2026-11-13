import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useComposerPopovers } from "./useComposerPopovers";

/**
 * The tray with the picker opened from it. The composer folds the tray when it
 * opens the picker, so this keeps both open to see how the two share the keys
 * and presses.
 */
function Harness() {
  const {
    mobileActionsTrigger,
    mobileActions,
    mobileActionsOpen,
    setMobileActionsOpen,
    emojiTrigger,
    emojiPanel,
    emojiOpen,
    setEmojiOpen,
  } = useComposerPopovers();
  return (
    <>
      <button
        ref={mobileActionsTrigger}
        type="button"
        aria-expanded={mobileActionsOpen}
        onClick={() => setMobileActionsOpen((open) => !open)}
      >
        Tray
      </button>
      <div ref={mobileActions} role="toolbar" hidden={!mobileActionsOpen}>
        <button
          ref={emojiTrigger}
          type="button"
          onClick={() => setEmojiOpen((open) => !open)}
        >
          Emoji
        </button>
      </div>
      {emojiOpen ? (
        <div ref={emojiPanel} role="dialog" aria-label="Picker">
          <div className="emo-pick">
            <button type="button">Cell</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const picker = () => screen.queryByRole("dialog", { name: "Picker" });

async function openBoth() {
  const user = userEvent.setup();
  render(<Harness />);
  const tray = screen.getByRole("button", { name: "Tray" });
  await user.click(tray);
  await user.click(screen.getByRole("button", { name: "Emoji" }));
  expect(picker()).toBeInTheDocument();
  expect(tray).toHaveAttribute("aria-expanded", "true");
  return { user, tray };
}

describe("the emoji picker open over the mobile tray", () => {
  it("closes on one Escape and leaves the tray open, then the next Escape closes the tray", async () => {
    const { user, tray } = await openBoth();

    await user.keyboard("{Escape}");
    expect(picker()).toBeNull();
    expect(tray).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Emoji" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(tray).toHaveAttribute("aria-expanded", "false");
    expect(tray).toHaveFocus();
  });

  it("closes alone on a press outside both, and the next press closes the tray", async () => {
    const { user, tray } = await openBoth();

    await user.click(document.body);
    expect(picker()).toBeNull();
    expect(tray).toHaveAttribute("aria-expanded", "true");

    await user.click(document.body);
    expect(tray).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open, with the tray, on a press inside the picker", async () => {
    const { user, tray } = await openBoth();

    await user.click(screen.getByRole("button", { name: "Cell" }));

    expect(picker()).toBeInTheDocument();
    expect(tray).toHaveAttribute("aria-expanded", "true");
  });
});
