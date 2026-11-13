"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_KEYBINDINGS,
  KEYBIND_ACTIONS,
  KEYBIND_STORAGE_KEY,
  actionForKeyboardEvent,
  chordFromEvent,
  chordsEqual,
  parseKeybindings,
  readStoredKeybindings,
  validateKeyChord,
  writeStoredKeybindings,
  type KeyChord,
  type KeybindAction,
  type KeybindRecordingError,
  type Keybindings,
} from "@/lib/keybinds";

import { useUiContext } from "./UiProvider";
import { useVoiceContext } from "./VoiceProvider";

export interface KeybindValue {
  bindings: Keybindings;
  /** The action whose chord the next key press will become. */
  recording: KeybindAction | null;
  /** Why the last recorded chord was refused. */
  recordingError: KeybindRecordingError | null;
  /** Starts recording for `action`, or stops if it is already recording. */
  beginRecording: (action: KeybindAction) => void;
  cancelRecording: () => void;
  clearBinding: (action: KeybindAction) => void;
  resetBindings: () => void;
  /** Every binding at once, as the account hands them back; validated first. */
  replaceBindings: (next: unknown) => void;
}

const KeybindContext = createContext<KeybindValue | null>(null);

/** Why `chord` cannot be given to `action`, or null when it can. */
function refusalFor(
  bindings: Keybindings,
  action: KeybindAction,
  chord: KeyChord,
): KeybindRecordingError | null {
  const validation = validateKeyChord(chord);
  if (validation !== "valid") return { kind: validation };
  const holder = KEYBIND_ACTIONS.find((other) => {
    const bound = bindings[other];
    return other !== action && bound !== null && chordsEqual(bound, chord);
  });
  return holder === undefined ? null : { kind: "conflict", action: holder };
}

/**
 * Global shortcuts for the call controls, and the recording of new ones.
 *
 * The listener runs in the capture phase so that a shortcut works wherever focus
 * is, and so that recording swallows the key before anything else sees it.
 */
export function KeybindProvider({ children }: { children: ReactNode }) {
  const { leaveCall } = useUiContext();
  const { channelId, toggleMute, toggleDeafen, toggleCamera } = useVoiceContext();
  const [bindings, setBindings] = useState(readStoredKeybindings);
  const [recording, setRecording] = useState<KeybindAction | null>(null);
  const [recordingError, setRecordingError] =
    useState<KeybindRecordingError | null>(null);

  const commit = useCallback((next: Keybindings) => {
    setBindings(next);
    writeStoredKeybindings(next);
  }, []);

  const cancelRecording = useCallback(() => {
    setRecording(null);
    setRecordingError(null);
  }, []);

  const beginRecording = useCallback((action: KeybindAction) => {
    setRecording((current) => (current === action ? null : action));
    setRecordingError(null);
  }, []);

  const clearBinding = useCallback(
    (action: KeybindAction) => {
      commit({ ...bindings, [action]: null });
      cancelRecording();
    },
    [bindings, commit, cancelRecording],
  );

  const resetBindings = useCallback(() => {
    commit({ ...DEFAULT_KEYBINDINGS });
    cancelRecording();
  }, [commit, cancelRecording]);

  const replaceBindings = useCallback(
    (next: unknown) => {
      commit(parseKeybindings(next));
      cancelRecording();
    },
    [commit, cancelRecording],
  );

  // Another window changed the bindings.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== KEYBIND_STORAGE_KEY || event.newValue === null) return;
      try {
        setBindings(parseKeybindings(JSON.parse(event.newValue)));
      } catch {
        // A malformed value does not replace the keys in use.
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const run: Record<KeybindAction, () => void> = {
      toggleMute,
      toggleDeafen,
      toggleCamera,
      disconnect: leaveCall,
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      if (recording !== null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "Escape") return cancelRecording();
        if (event.code === "Backspace" || event.code === "Delete") {
          return clearBinding(recording);
        }
        // Modifiers alone do not make a chord; keep waiting for the main key.
        const chord = chordFromEvent(event);
        if (chord === null) return;
        const refusal = refusalFor(bindings, recording, chord);
        if (refusal !== null) return setRecordingError(refusal);
        commit({ ...bindings, [recording]: chord });
        return cancelRecording();
      }

      const action = actionForKeyboardEvent(bindings, event);
      if (action === null || channelId === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      run[action]();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    bindings,
    recording,
    channelId,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    leaveCall,
    commit,
    clearBinding,
    cancelRecording,
  ]);

  const value = useMemo<KeybindValue>(
    () => ({
      bindings,
      recording,
      recordingError,
      beginRecording,
      cancelRecording,
      clearBinding,
      resetBindings,
      replaceBindings,
    }),
    [
      bindings,
      recording,
      recordingError,
      beginRecording,
      cancelRecording,
      clearBinding,
      resetBindings,
      replaceBindings,
    ],
  );

  return (
    <KeybindContext.Provider value={value}>{children}</KeybindContext.Provider>
  );
}

export function useKeybindContext(): KeybindValue {
  const value = useContext(KeybindContext);
  if (value === null) {
    throw new Error("useKeybinds must be used inside <KeybindProvider>");
  }
  return value;
}
