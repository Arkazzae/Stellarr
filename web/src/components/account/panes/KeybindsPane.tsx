"use client";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import {
  DEFAULT_KEYBINDINGS,
  KEYBIND_ACTIONS,
  chordsEqual,
  keyChordParts,
  type KeybindAction,
  type KeybindRecordingError,
  type Keybindings,
} from "@/lib/keybinds";
import { useLanguage } from "@/state/hooks";
import type { Translator } from "@/i18n";

import { VoiceSection } from "./VoiceFields";

export interface KeybindsPaneProps {
  bindings: Keybindings;
  /** The action whose shortcut is waiting for a key press, if any. */
  recording: KeybindAction | null;
  recordingError: KeybindRecordingError | null;
  beginRecording: (action: KeybindAction) => void;
  clearBinding: (action: KeybindAction) => void;
  resetBindings: () => void;
}

const ACTION_DETAIL_KEYS = {
  toggleMute: "keybinds.toggleMuteDetail",
  toggleDeafen: "keybinds.toggleDeafenDetail",
  toggleCamera: "keybinds.toggleCameraDetail",
  disconnect: "keybinds.disconnectDetail",
} as const satisfies Record<KeybindAction, string>;

const ACTION_LABEL_KEYS = {
  toggleMute: "keybinds.toggleMute",
  toggleDeafen: "keybinds.toggleDeafen",
  toggleCamera: "keybinds.toggleCamera",
  disconnect: "keybinds.disconnect",
} as const satisfies Record<KeybindAction, string>;

/** Shortcuts the app fixes for everyone, listed so they can be found. */
const FIXED_SHORTCUTS = [
  {
    caption: "keybinds.everywhere",
    items: [
      { keys: ["Esc"], what: "keybinds.closeSurface" },
      { keys: ["Tab"], what: "keybinds.dialogFocus" },
    ],
  },
  {
    caption: "keybinds.typing",
    items: [
      { keys: ["Enter"], what: "keybinds.sendMessage" },
      { keys: ["Shift", "Enter"], what: "keybinds.newLine" },
    ],
  },
  {
    caption: "keybinds.lists",
    items: [
      { keys: ["↑", "↓"], what: "keybinds.reorderChannel" },
      { keys: ["←", "→"], what: "keybinds.seekMedia" },
      { keys: ["Home", "End"], what: "keybinds.jumpRecording" },
    ],
  },
  {
    caption: "keybinds.mediaPreview",
    items: [{ keys: ["←", "→"], what: "keybinds.previousNextImage" }],
  },
] as const;

function Keys({ keys }: { keys: readonly string[] }) {
  return keys.map((key) => (
    <kbd className="kb-key" key={key}>{key}</kbd>
  ));
}

function recordingMessage(
  error: KeybindRecordingError,
  actionLabel: (action: KeybindAction) => string,
  t: Translator,
): string {
  if (error.kind === "conflict") {
    return t("keybinds.conflict", { action: actionLabel(error.action) });
  }
  return error.kind === "reserved" ? t("keybinds.reserved") : t("keybinds.needsModifier");
}

function isDefault(bindings: Keybindings): boolean {
  return KEYBIND_ACTIONS.every((action) => {
    const current = bindings[action];
    const fallback = DEFAULT_KEYBINDINGS[action];
    if (current === null || fallback === null) return current === fallback;
    return chordsEqual(current, fallback);
  });
}

export function KeybindsPane({
  bindings,
  recording,
  recordingError,
  beginRecording,
  clearBinding,
  resetBindings,
}: KeybindsPaneProps) {
  const { t } = useLanguage();
  const actionLabel = (action: KeybindAction) => t(ACTION_LABEL_KEYS[action]);

  return (
    <>
      <p className="set-note">{t("keybinds.customNote")}</p>

      <VoiceSection icon="mic" title={t("keybinds.voiceControls")}>
        <ul className="kb-list">
          {KEYBIND_ACTIONS.map((action) => {
            const binding = bindings[action];
            const listening = recording === action;
            const label = actionLabel(action);
            return (
              <li className="kb-row kb-edit-row" key={action}>
                <span className="kb-action-copy">
                  <b>{label}</b>
                  <span>{t(ACTION_DETAIL_KEYS[action])}</span>
                </span>
                <span className="kb-binding-actions">
                  <button
                    type="button"
                    className={listening ? "kb-record recording" : "kb-record"}
                    aria-pressed={listening}
                    aria-label={listening
                      ? t("keybinds.cancelRecording", { action: label })
                      : t("keybinds.change", { action: label })}
                    onClick={() => beginRecording(action)}
                  >
                    {listening ? (
                      <span className="kb-listening">{t("keybinds.pressShortcut")}</span>
                    ) : binding === null ? (
                      <span className="kb-unassigned">{t("keybinds.unassigned")}</span>
                    ) : (
                      <Keys keys={keyChordParts(binding)} />
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="kb-clear"
                    disabled={binding === null}
                    aria-label={t("keybinds.clearOne", { action: label })}
                    onClick={() => clearBinding(action)}
                  >
                    {t("keybinds.clear")}
                  </Button>
                </span>
                {listening && recordingError !== null ? (
                  <span className="kb-error" role="alert">
                    {recordingMessage(recordingError, actionLabel, t)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="kb-reset-row">
          <span>{t("keybinds.recordingHint")}</span>
          <Button
            type="button"
            variant="secondary"
            disabled={isDefault(bindings)}
            onClick={resetBindings}
          >
            {t("keybinds.reset")}
          </Button>
        </div>
      </VoiceSection>

      <p className="set-note">{t("keybinds.fixedNote")}</p>
      {FIXED_SHORTCUTS.map((group) => (
        <section className="sc" key={group.caption}>
          <header className="sc-h">
            <span className="sc-ico" aria-hidden="true">
              <Icon name="sliders" size={17} />
            </span>
            {t(group.caption)}
          </header>
          <div className="sc-b">
            <ul className="kb-list">
              {group.items.map((item) => (
                <li className="kb-row" key={item.what}>
                  <span className="kb-keys">
                    <Keys keys={item.keys} />
                  </span>
                  <span className="kb-what">{t(item.what)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </>
  );
}
