import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_KEYBINDINGS,
  readStoredKeybindings,
  writeStoredKeybindings,
} from "@/lib/keybinds";

import { KeybindProvider, useKeybindContext } from "./KeybindProvider";

const owners = vi.hoisted(() => ({
  leaveCall: vi.fn(),
  voice: {
    channelId: "voice-1" as string | null,
    toggleCamera: vi.fn(),
    toggleDeafen: vi.fn(),
    toggleMute: vi.fn(),
  },
}));

vi.mock("./UiProvider", () => ({
  useUiContext: () => ({ leaveCall: owners.leaveCall }),
}));

vi.mock("./VoiceProvider", () => ({
  useVoiceContext: () => owners.voice,
}));

function Harness() {
  const keybinds = useKeybindContext();
  return (
    <>
      <button
        type="button"
        onClick={() => keybinds.beginRecording("toggleMute")}
      >
        record
      </button>
      <output>{keybinds.recordingError?.kind ?? "ready"}</output>
    </>
  );
}

describe("KeybindProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    owners.voice.channelId = "voice-1";
    vi.clearAllMocks();
  });

  it("routes default and custom shortcuts to their voice action owners", () => {
    writeStoredKeybindings({
      ...DEFAULT_KEYBINDINGS,
      toggleCamera: {
        code: "KeyG",
        ctrl: true,
        alt: true,
        shift: false,
        meta: false,
      },
    });
    render(<KeybindProvider><span>call</span></KeybindProvider>);

    fireEvent.keyDown(document, { code: "KeyM", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document, { code: "KeyE", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document, { code: "KeyG", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { code: "KeyH", ctrlKey: true, shiftKey: true });

    expect(owners.voice.toggleMute).toHaveBeenCalledOnce();
    expect(owners.voice.toggleDeafen).toHaveBeenCalledOnce();
    expect(owners.voice.toggleCamera).toHaveBeenCalledOnce();
    expect(owners.leaveCall).toHaveBeenCalledOnce();
  });

  it("does not take over shortcuts when there is no active call", () => {
    owners.voice.channelId = null;
    render(<KeybindProvider><span>idle</span></KeybindProvider>);

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyM",
      ctrlKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    expect(owners.voice.toggleMute).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("reports conflicts, then stores a valid replacement", () => {
    render(<KeybindProvider><Harness /></KeybindProvider>);
    fireEvent.click(screen.getByRole("button", { name: "record" }));

    fireEvent.keyDown(document, { code: "KeyE", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("conflict")).toBeInTheDocument();

    fireEvent.keyDown(document, { code: "KeyQ", ctrlKey: true, altKey: true });

    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(readStoredKeybindings().toggleMute).toEqual({
      code: "KeyQ",
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    });
  });

  it("takes a whole set from the account, validated like stored ones", () => {
    const chord = { code: "KeyJ", ctrl: true, alt: true, shift: false, meta: false };
    function Taker() {
      const { replaceBindings } = useKeybindContext();
      return (
        <button
          type="button"
          onClick={() =>
            replaceBindings({
              version: 1,
              // A duplicate is dropped, as it would be from storage.
              bindings: { ...DEFAULT_KEYBINDINGS, toggleMute: chord, toggleCamera: chord },
            })
          }
        >
          replace
        </button>
      );
    }
    render(<KeybindProvider><Taker /></KeybindProvider>);

    fireEvent.click(screen.getByRole("button", { name: "replace" }));

    expect(readStoredKeybindings()).toMatchObject({ toggleMute: chord, toggleCamera: null });
  });
});
