import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_KEYBINDINGS,
  KEYBIND_STORAGE_KEY,
  actionForKeyboardEvent,
  keyChordParts,
  parseKeybindings,
  readStoredKeybindings,
  validateKeyChord,
  writeStoredKeybindings,
  type KeyChord,
} from "./keybinds";

const muteChord = DEFAULT_KEYBINDINGS.toggleMute as KeyChord;

describe("keybinds", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("falls back to safe defaults when stored data is malformed", () => {
    window.localStorage.setItem(KEYBIND_STORAGE_KEY, "not-json");

    expect(readStoredKeybindings()).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("preserves cleared actions and removes duplicate stored bindings", () => {
    const parsed = parseKeybindings({
      version: 1,
      bindings: {
        ...DEFAULT_KEYBINDINGS,
        toggleCamera: null,
        disconnect: muteChord,
      },
    });

    expect(parsed.toggleCamera).toBeNull();
    expect(parsed.disconnect).toBeNull();
    expect(parsed.toggleMute).toEqual(muteChord);
  });

  it("requires a modifier and rejects shortcuts owned by the app", () => {
    expect(validateKeyChord({
      code: "KeyM",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    })).toBe("needs-modifier");
    expect(validateKeyChord({
      code: "KeyK",
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    })).toBe("reserved");
    expect(validateKeyChord({
      code: "F13",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    })).toBe("valid");
  });

  it("matches the exact modifier combination and ignores near misses", () => {
    expect(actionForKeyboardEvent(
      DEFAULT_KEYBINDINGS,
      new KeyboardEvent("keydown", {
        code: "KeyM",
        ctrlKey: true,
        shiftKey: true,
      }),
    )).toBe("toggleMute");
    expect(actionForKeyboardEvent(
      DEFAULT_KEYBINDINGS,
      new KeyboardEvent("keydown", {
        altKey: true,
        code: "KeyM",
        ctrlKey: true,
        shiftKey: true,
      }),
    )).toBeNull();
  });

  it("writes a versioned value and restores it", () => {
    const bindings = { ...DEFAULT_KEYBINDINGS, disconnect: null };

    writeStoredKeybindings(bindings);

    expect(JSON.parse(
      window.localStorage.getItem(KEYBIND_STORAGE_KEY) ?? "{}",
    )).toMatchObject({ version: 1 });
    expect(readStoredKeybindings()).toEqual(bindings);
    expect(keyChordParts(muteChord)).toEqual(["Ctrl", "Shift", "M"]);
  });
});
