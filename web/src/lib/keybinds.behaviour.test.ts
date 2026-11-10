import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_KEYBINDINGS,
  KEYBIND_STORAGE_KEY,
  actionForKeyboardEvent,
  chordFromEvent,
  keyChordParts,
  parseKeybindings,
  readStoredKeybindings,
  validateKeyChord,
  writeStoredKeybindings,
  type KeyChord,
} from "./keybinds";

const none = { ctrl: false, alt: false, shift: false, meta: false };

function chord(code: string, modifiers: Partial<Omit<KeyChord, "code">> = {}) {
  return { code, ...none, ...modifiers };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("restoring stored bindings", () => {
  it("ignores data written by another version", () => {
    expect(
      parseKeybindings({ version: 2, bindings: { toggleMute: null } }),
    ).toEqual(DEFAULT_KEYBINDINGS);
    expect(parseKeybindings("toggleMute")).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("keeps a cleared action cleared instead of restoring its default", () => {
    const parsed = parseKeybindings({
      version: 1,
      bindings: { toggleMute: null },
    });

    expect(parsed.toggleMute).toBeNull();
    expect(parsed.toggleDeafen).toEqual(DEFAULT_KEYBINDINGS.toggleDeafen);
  });

  it("falls back to the default for a binding that is malformed or no longer valid", () => {
    const parsed = parseKeybindings({
      version: 1,
      bindings: {
        toggleMute: { code: "KeyM" },
        toggleDeafen: chord("KeyK", { ctrl: true }),
        disconnect: chord("KeyH"),
      },
    });

    expect(parsed).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("clears the later action when a fallback default collides with an earlier binding", () => {
    const parsed = parseKeybindings({
      version: 1,
      bindings: {
        toggleMute: DEFAULT_KEYBINDINGS.disconnect,
        toggleDeafen: null,
        disconnect: "broken",
      },
    });

    expect(parsed.toggleMute).toEqual(DEFAULT_KEYBINDINGS.disconnect);
    expect(parsed.disconnect).toBeNull();
  });

  it("returns a fresh object so callers cannot change the defaults", () => {
    const first = readStoredKeybindings();
    first.toggleMute = null;

    expect(readStoredKeybindings().toggleMute).toEqual(
      DEFAULT_KEYBINDINGS.toggleMute,
    );
  });
});

describe("storage that is missing or refuses access", () => {
  it("reads defaults and drops writes without storage", () => {
    expect(readStoredKeybindings(null)).toEqual(DEFAULT_KEYBINDINGS);
    expect(() => writeStoredKeybindings(DEFAULT_KEYBINDINGS, null)).not.toThrow();
  });

  it("does not throw when the browser rejects a write", () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new DOMException("quota", "QuotaExceededError");
      }),
    } as unknown as Storage;

    expect(() => writeStoredKeybindings(DEFAULT_KEYBINDINGS, storage)).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledWith(
      KEYBIND_STORAGE_KEY,
      expect.any(String),
    );
  });
});

describe("validating a chord", () => {
  it("does not accept Shift as the only modifier", () => {
    expect(validateKeyChord(chord("KeyM", { shift: true }))).toBe("needs-modifier");
  });

  it("accepts function keys and Alt without further modifiers", () => {
    expect(validateKeyChord(chord("F1"))).toBe("valid");
    expect(validateKeyChord(chord("F24"))).toBe("valid");
    expect(validateKeyChord(chord("F25"))).toBe("needs-modifier");
    expect(validateKeyChord(chord("KeyM", { alt: true }))).toBe("valid");
  });

  it("reserves browser shortcuts only without Alt", () => {
    expect(validateKeyChord(chord("KeyW", { meta: true }))).toBe("reserved");
    expect(validateKeyChord(chord("KeyW", { ctrl: true, alt: true }))).toBe("valid");
  });

  it("reserves the developer-tools shortcuts only together with Shift", () => {
    expect(validateKeyChord(chord("KeyI", { ctrl: true, shift: true }))).toBe("reserved");
    expect(validateKeyChord(chord("KeyI", { ctrl: true }))).toBe("valid");
  });
});

describe("matching key presses", () => {
  it("ignores a press made of modifiers only", () => {
    expect(chordFromEvent(new KeyboardEvent("keydown", { code: "ControlLeft", ctrlKey: true }))).toBeNull();
    expect(chordFromEvent(new KeyboardEvent("keydown", { code: "" }))).toBeNull();
  });

  it("ignores a press while an input method is composing", () => {
    expect(
      actionForKeyboardEvent(
        DEFAULT_KEYBINDINGS,
        new KeyboardEvent("keydown", {
          code: "KeyM",
          ctrlKey: true,
          shiftKey: true,
          isComposing: true,
        }),
      ),
    ).toBeNull();
  });

  it("ignores AltGr, which Windows reports as Ctrl and Alt", () => {
    const bindings = {
      ...DEFAULT_KEYBINDINGS,
      toggleCamera: chord("KeyA", { ctrl: true, alt: true }),
    };
    const altGr = new KeyboardEvent("keydown", {
      code: "KeyA",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });

    expect(actionForKeyboardEvent(bindings, altGr)).toBeNull();
  });

  it("does not trigger an action that was cleared", () => {
    const bindings = { ...DEFAULT_KEYBINDINGS, toggleMute: null };

    expect(
      actionForKeyboardEvent(
        bindings,
        new KeyboardEvent("keydown", { code: "KeyM", ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull();
  });
});

describe("labelling a chord", () => {
  it.each([
    [chord("Digit5", { ctrl: true }), ["Ctrl", "5"]],
    [chord("Numpad7", { alt: true }), ["Alt", "Num 7"]],
    [chord("ArrowUp", { ctrl: true, alt: true, shift: true, meta: true }), ["Ctrl", "Alt", "Shift", "Meta", "↑"]],
    [chord("PageDown", { alt: true }), ["Alt", "Page Down"]],
    [chord("F5"), ["F5"]],
  ])("%j reads as %j", (input, expected) => {
    expect(keyChordParts(input)).toEqual(expected);
  });
});
