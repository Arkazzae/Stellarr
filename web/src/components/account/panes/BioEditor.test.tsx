import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Modal } from "@/components/primitives/Modal";

import { BioEditor } from "./BioEditor";

/** The editor inside a dialog, as the account settings hold it. */
function Settings() {
  const [open, setOpen] = useState(true);
  const [bio, setBio] = useState("");
  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="settings-title" className="sv-wrap">
      <h2 id="settings-title">Konto</h2>
      <BioEditor value={bio} customEmoji={[]} onChange={setBio} />
    </Modal>
  );
}

const picker = () => screen.queryByRole("dialog", { name: "Wybierz emoji" });
const settings = () => screen.queryByRole("dialog", { name: "Konto" });

describe("BioEditor emoji panel in a dialog", () => {
  async function openPanel() {
    const user = userEvent.setup();
    render(<Settings />);
    const trigger = screen.getByRole("button", { name: "Dodaj emoji" });
    await user.click(trigger);
    expect(picker()).toBeInTheDocument();
    // The focus rests on the button, not in the picker's own search field,
    // which would take the key itself.
    trigger.focus();
    return { user, trigger };
  }

  it("closes on Escape and leaves the dialog open, then the next Escape closes the dialog", async () => {
    const { user, trigger } = await openPanel();

    await user.keyboard("{Escape}");
    expect(picker()).toBeNull();
    expect(settings()).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(settings()).toBeNull();
  });

  it("closes on a press outside, but not on a press inside it or on its button", async () => {
    const { user, trigger } = await openPanel();

    await user.click(screen.getByRole("textbox", { name: "Szukaj emoji" }));
    expect(picker()).toBeInTheDocument();
    fireEvent.pointerDown(trigger);
    expect(picker()).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Konto" }));
    expect(picker()).toBeNull();
    expect(settings()).toBeInTheDocument();
    expect(trigger).toBeInTheDocument();
  });
});
