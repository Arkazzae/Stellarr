export const KEYBIND_STORAGE_KEY = "stellarr.keybinds.v1";

export const KEYBIND_ACTIONS = [
  "toggleMute",
  "toggleDeafen",
  "toggleCamera",
  "disconnect",
] as const;

export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export interface KeyChord {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type Keybindings = Record<KeybindAction, KeyChord | null>;
export type KeybindValidation = "valid" | "needs-modifier" | "reserved";
export type KeybindRecordingError =
  | { kind: Exclude<KeybindValidation, "valid"> }
  | { kind: "conflict"; action: KeybindAction };

const STORAGE_VERSION = 1;

/** Keys that only describe a chord and cannot be its main key. */
const MODIFIER_CODES: ReadonlySet<string> = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

/** With Ctrl or Cmd these belong to the browser (zoom, find, tabs, ...) or to the app. */
const RESERVED_COMMAND_CODES: ReadonlySet<string> = new Set([
  "Digit0",
  "Equal",
  "KeyF",
  "KeyK",
  "KeyL",
  "KeyN",
  "KeyO",
  "KeyP",
  "KeyR",
  "KeyS",
  "KeyT",
  "KeyW",
  "Minus",
]);

/** Ctrl or Cmd with Shift opens the browser's developer tools and inspectors. */
const RESERVED_SHIFT_COMMAND_CODES: ReadonlySet<string> = new Set([
  "KeyC",
  "KeyD",
  "KeyI",
]);

function ctrlShift(code: string): KeyChord {
  return Object.freeze({ code, ctrl: true, alt: false, shift: true, meta: false });
}

export const DEFAULT_KEYBINDINGS: Keybindings = Object.freeze({
  toggleMute: ctrlShift("KeyM"),
  toggleDeafen: ctrlShift("KeyE"),
  toggleCamera: null,
  disconnect: ctrlShift("KeyH"),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one stored binding. `null` is a deliberately cleared action, while
 * `undefined` means the stored value is unusable and the default applies.
 */
function parseStoredChord(value: unknown): KeyChord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;

  const { code, ctrl, alt, shift, meta } = value;
  if (
    typeof code !== "string" ||
    code === "" ||
    typeof ctrl !== "boolean" ||
    typeof alt !== "boolean" ||
    typeof shift !== "boolean" ||
    typeof meta !== "boolean"
  ) {
    return undefined;
  }

  const chord: KeyChord = { code, ctrl, alt, shift, meta };
  return validateKeyChord(chord) === "valid" ? chord : undefined;
}

/** Restores bindings from untrusted storage, never leaving two actions on one chord. */
export function parseKeybindings(value: unknown): Keybindings {
  const stored =
    isRecord(value) && value["version"] === STORAGE_VERSION
      ? value["bindings"]
      : undefined;
  const result: Keybindings = { ...DEFAULT_KEYBINDINGS };
  if (!isRecord(stored)) return result;

  const taken: KeyChord[] = [];
  for (const action of KEYBIND_ACTIONS) {
    const parsed = parseStoredChord(stored[action]);
    const candidate = parsed === undefined ? DEFAULT_KEYBINDINGS[action] : parsed;
    const duplicate =
      candidate !== null && taken.some((chord) => chordsEqual(chord, candidate));

    result[action] = duplicate ? null : candidate;
    if (!duplicate && candidate !== null) taken.push(candidate);
  }
  return result;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return null;
  }
}

export function readStoredKeybindings(
  storage: Storage | null = safeStorage(),
): Keybindings {
  try {
    const raw = storage?.getItem(KEYBIND_STORAGE_KEY) ?? null;
    if (raw !== null) return parseKeybindings(JSON.parse(raw));
  } catch {
    // Unreadable or corrupt storage falls through to the defaults.
  }
  return { ...DEFAULT_KEYBINDINGS };
}

export function writeStoredKeybindings(
  bindings: Keybindings,
  storage: Storage | null = safeStorage(),
): void {
  try {
    storage?.setItem(
      KEYBIND_STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, bindings }),
    );
  } catch {
    // A private or locked-down profile may reject storage. The session keeps
    // the binding in memory, so the control still works until the page closes.
  }
}

/** The chord a key press makes, or `null` while only modifiers are held. */
export function chordFromEvent(event: KeyboardEvent): KeyChord | null {
  if (event.code === "" || MODIFIER_CODES.has(event.code)) return null;
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}

export function validateKeyChord(chord: KeyChord): KeybindValidation {
  const isFunctionKey = /^F(?:[1-9]|1\d|2[0-4])$/.test(chord.code);
  const isCommand = chord.ctrl || chord.meta;

  // Shift alone is not enough: it would fire on ordinary typing.
  if (!isCommand && !chord.alt && !isFunctionKey) return "needs-modifier";

  if (isCommand && !chord.alt) {
    if (RESERVED_COMMAND_CODES.has(chord.code)) return "reserved";
    if (chord.shift && RESERVED_SHIFT_COMMAND_CODES.has(chord.code)) {
      return "reserved";
    }
  }
  return "valid";
}

export function chordsEqual(left: KeyChord, right: KeyChord): boolean {
  return (
    left.code === right.code &&
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta
  );
}

/** The action a key press triggers, if any. */
export function actionForKeyboardEvent(
  bindings: Keybindings,
  event: KeyboardEvent,
): KeybindAction | null {
  // AltGr reports Ctrl+Alt on Windows, and a composing IME is mid-word.
  if (event.isComposing || event.getModifierState("AltGraph")) return null;

  const pressed = chordFromEvent(event);
  if (pressed === null) return null;

  return (
    KEYBIND_ACTIONS.find((action) => {
      const bound = bindings[action];
      return bound !== null && chordsEqual(bound, pressed);
    }) ?? null
  );
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
};

function keyLabel(code: string): string {
  const character = /^(?:Key|Digit)([A-Z0-9])$/.exec(code)?.[1];
  if (character !== undefined) return character;
  if (code.startsWith("Numpad")) return `Num ${code.slice("Numpad".length)}`;
  return KEY_LABELS[code] ?? code;
}

/** The chord as separate labels, in the order a keyboard legend shows them. */
export function keyChordParts(chord: KeyChord): string[] {
  const modifiers: [boolean, string][] = [
    [chord.ctrl, "Ctrl"],
    [chord.alt, "Alt"],
    [chord.shift, "Shift"],
    [chord.meta, "Meta"],
  ];
  return [
    ...modifiers.filter(([held]) => held).map(([, label]) => label),
    keyLabel(chord.code),
  ];
}
