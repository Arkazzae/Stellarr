import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_KEYBINDINGS,
  KEYBIND_STORAGE_KEY,
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
      <button type="button" onClick={() => keybinds.beginRecording("toggleMute")}>
        record mute
      </button>
      <button type="button" onClick={keybinds.resetBindings}>
        reset
      </button>
      <output aria-label="recording">{keybinds.recording ?? "idle"}</output>
      <output aria-label="error">{keybinds.recordingError?.kind ?? "none"}</output>
      <output aria-label="mute">{keybinds.bindings.toggleMute?.code ?? "unbound"}</output>
    </>
  );
}

function mount() {
  render(
    <KeybindProvider>
      <Harness />
    </KeybindProvider>,
  );
}

function startRecording() {
  fireEvent.click(screen.getByRole("button", { name: "record mute" }));
}

describe("KeybindProvider recording", () => {
  beforeEach(() => {
    window.localStorage.clear();
    owners.voice.channelId = "voice-1";
    vi.clearAllMocks();
  });

  it("stops recording when the same control is pressed again", () => {
    mount();

    startRecording();
    expect(screen.getByLabelText("recording")).toHaveTextContent("toggleMute");
    startRecording();

    expect(screen.getByLabelText("recording")).toHaveTextContent("idle");
  });

  it("swallows every key while recording, so a bound shortcut does not also fire", () => {
    mount();
    const later = vi.fn();
    document.addEventListener("keydown", later);
    startRecording();

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyE",
      ctrlKey: true,
      shiftKey: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    expect(owners.voice.toggleDeafen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", later);
  });

  it("records even with no call, because the shortcuts page is not in a call", () => {
    owners.voice.channelId = null;
    mount();
    startRecording();

    fireEvent.keyDown(document, { code: "KeyQ", ctrlKey: true, altKey: true });

    expect(screen.getByLabelText("mute")).toHaveTextContent("KeyQ");
  });

  it("waits through a bare modifier, then refuses a chord that needs one", () => {
    mount();
    startRecording();

    fireEvent.keyDown(document, { code: "ControlLeft", ctrlKey: true });
    expect(screen.getByLabelText("error")).toHaveTextContent("none");

    fireEvent.keyDown(document, { code: "KeyA" });
    expect(screen.getByLabelText("error")).toHaveTextContent("needs-modifier");
    expect(screen.getByLabelText("recording")).toHaveTextContent("toggleMute");
  });

  it("refuses a chord the browser owns", () => {
    mount();
    startRecording();

    fireEvent.keyDown(document, { code: "KeyW", ctrlKey: true });

    expect(screen.getByLabelText("error")).toHaveTextContent("reserved");
  });

  it("ignores auto-repeat while recording", () => {
    mount();
    startRecording();

    fireEvent.keyDown(document, { code: "KeyQ", ctrlKey: true, altKey: true, repeat: true });

    expect(screen.getByLabelText("recording")).toHaveTextContent("toggleMute");
  });

  it("cancels on Escape without changing the binding", () => {
    mount();
    startRecording();

    fireEvent.keyDown(document, { code: "Escape" });

    expect(screen.getByLabelText("recording")).toHaveTextContent("idle");
    expect(readStoredKeybindings().toggleMute).toEqual(DEFAULT_KEYBINDINGS.toggleMute);
  });

  it("unbinds the action on Backspace and persists that", () => {
    mount();
    startRecording();

    fireEvent.keyDown(document, { code: "Backspace" });

    expect(screen.getByLabelText("mute")).toHaveTextContent("unbound");
    expect(screen.getByLabelText("recording")).toHaveTextContent("idle");
    expect(readStoredKeybindings().toggleMute).toBeNull();
  });

  it("restores the defaults on reset", () => {
    writeStoredKeybindings({ ...DEFAULT_KEYBINDINGS, toggleMute: null });
    mount();
    expect(screen.getByLabelText("mute")).toHaveTextContent("unbound");

    fireEvent.click(screen.getByRole("button", { name: "reset" }));

    expect(screen.getByLabelText("mute")).toHaveTextContent("KeyM");
    expect(readStoredKeybindings().toggleMute).toEqual(DEFAULT_KEYBINDINGS.toggleMute);
  });
});

describe("KeybindProvider across windows", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("adopts bindings stored by another window", () => {
    mount();
    const changed = {
      version: 1,
      bindings: {
        ...DEFAULT_KEYBINDINGS,
        toggleMute: { code: "KeyJ", ctrl: true, alt: true, shift: false, meta: false },
      },
    };

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEYBIND_STORAGE_KEY,
          newValue: JSON.stringify(changed),
        }),
      );
    });

    expect(screen.getByLabelText("mute")).toHaveTextContent("KeyJ");
  });

  it("keeps its keys when another window stores something unreadable", () => {
    mount();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: KEYBIND_STORAGE_KEY, newValue: "{not json" }),
      );
    });

    expect(screen.getByLabelText("mute")).toHaveTextContent("KeyM");
  });
});
