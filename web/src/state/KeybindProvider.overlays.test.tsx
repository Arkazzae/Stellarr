import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/primitives/Modal";

import { KeybindProvider, useKeybindContext } from "./KeybindProvider";

vi.mock("./UiProvider", () => ({
  useUiContext: () => ({ leaveCall: vi.fn() }),
}));

vi.mock("./VoiceProvider", () => ({
  useVoiceContext: () => ({
    channelId: "voice-1",
    toggleCamera: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleMute: vi.fn(),
  }),
}));

/** A settings dialog with a control that starts recording a shortcut, as the keybinds pane has. */
function Harness({ onClose }: { onClose: () => void }) {
  const keybinds = useKeybindContext();
  const [open, setOpen] = useState(true);
  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      labelledBy="title"
      className="sv-wrap"
    >
      <h2 id="title">Settings</h2>
      <button type="button" onClick={() => keybinds.beginRecording("toggleMute")}>
        record mute
      </button>
      <button type="button">Other</button>
      <output aria-label="recording">{keybinds.recording ?? "idle"}</output>
    </Modal>
  );
}

function mount() {
  const onClose = vi.fn();
  render(
    <KeybindProvider>
      <Harness onClose={onClose} />
    </KeybindProvider>,
  );
  return onClose;
}

describe("KeybindProvider recording inside a dialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("takes Escape for itself, and the next one closes the dialog", async () => {
    const user = userEvent.setup();
    const onClose = mount();
    await user.click(screen.getByRole("button", { name: "record mute" }));
    expect(screen.getByLabelText("recording")).toHaveTextContent("toggleMute");

    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("recording")).toHaveTextContent("idle");
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes a key for the shortcut without the dialog hearing it", async () => {
    const user = userEvent.setup();
    const onClose = mount();
    await user.click(screen.getByRole("button", { name: "record mute" }));

    await user.keyboard("{Control>}m{/Control}");

    expect(screen.getByLabelText("recording")).toHaveTextContent("idle");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Tab from moving the focus while recording", async () => {
    const user = userEvent.setup();
    mount();
    const record = screen.getByRole("button", { name: "record mute" });
    await user.click(record);

    await user.keyboard("{Tab}");

    expect(record).toHaveFocus();
    expect(screen.getByLabelText("recording")).toHaveTextContent("toggleMute");
  });

  it("is cancelled by Escape sent straight to the document, as well", () => {
    const onClose = mount();
    fireEvent.click(screen.getByRole("button", { name: "record mute" }));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(screen.getByLabelText("recording")).toHaveTextContent("idle");
    expect(onClose).not.toHaveBeenCalled();
  });
});
