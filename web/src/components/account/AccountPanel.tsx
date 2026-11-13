"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { AnchoredCard } from "@/components/primitives/AnchoredCard";
import { PresenceDot } from "@/components/primitives/Avatar";
import { EmojiPicker } from "@/components/room/EmojiPicker";
import type { CustomEmoji, Presence } from "@/ports";
import { PRESENCE_VALUES, SELF_PRESENCE_LABEL } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** A status stays a glanceable line; the longer text belongs to the bio. */
const STATUS_MAX_LENGTH = 128;
/** How long the save button keeps showing its tick. */
const SAVED_FLASH_MS = 1500;

/** One-tap openers for the status line. */
const SUGGESTED_EMOJI = ["🎧", "🎮", "🛠️", "📚", "☕", "💤"] as const;

/**
 * The glyph or `:shortcode:` a status starts with, and the space after it.
 * Pictographs may carry an emoji variation selector (U+FE0F).
 */
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}️?|:[a-zA-Z0-9_-]{2,64}:)\s*/u;

export interface AccountPanelProps {
  presence: Presence;
  customStatus: string;
  customEmoji?: readonly CustomEmoji[];
  onSetPresence: (presence: Presence) => void;
  onSaveCustomStatus: (customStatus: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

interface StatusEditorProps {
  customStatus: string;
  customEmoji: readonly CustomEmoji[];
  onSave: (customStatus: string) => void;
}

/** The short line under the user's name, with its emoji openers. */
function StatusEditor({ customStatus, customEmoji, onSave }: StatusEditorProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(customStatus);
  const [saved, setSaved] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [pickerAutoFocus, setPickerAutoFocus] = useState(true);
  const savedTimer = useRef<number | undefined>(undefined);

  // The status changed somewhere else, such as in another tab: start the
  // draft over from it instead of keeping an edit that no longer applies.
  const [seenStatus, setSeenStatus] = useState(customStatus);
  if (seenStatus !== customStatus) {
    setSeenStatus(customStatus);
    setDraft(customStatus);
  }

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const dirty = draft.trim() !== customStatus.trim();
  const leadingEmoji = LEADING_EMOJI.exec(draft)?.[1];
  const showsSaved = saved && !dirty;

  const save = () => {
    if (!dirty) return;
    onSave(draft.trim());
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  };

  /** Puts the emoji first, or takes it off again when it already leads. */
  const toggleLeading = (emoji: string) => {
    const rest = draft.replace(LEADING_EMOJI, "");
    setDraft(emoji === leadingEmoji ? rest : `${emoji} ${rest}`.trimEnd());
  };

  const togglePicker = (button: HTMLElement) =>
    setPickerAnchor((anchor) => (anchor === null ? button : null));

  return (
    <section className="acc-status" aria-labelledby="acc-status-cap">
      <h4 className="acc-cap" id="acc-status-cap">
        {t("account.yourStatus")}
      </h4>

      <div className="acc-picks">
        {SUGGESTED_EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className={emoji === leadingEmoji ? "acc-pick on" : "acc-pick"}
            aria-label={t("account.startStatusWith", { emoji })}
            aria-pressed={emoji === leadingEmoji}
            onClick={() => toggleLeading(emoji)}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className={pickerAnchor === null ? "acc-pick" : "acc-pick on"}
          aria-label={t("account.addEmoji")}
          title={t("account.addEmoji")}
          aria-haspopup="dialog"
          aria-expanded={pickerAnchor !== null}
          // Touch and pen keep the search field unfocused, so opening the
          // catalogue does not raise the software keyboard. A click with no
          // pointer behind it (detail 0) is the keyboard, which wants focus.
          onPointerDown={(event) =>
            setPickerAutoFocus(event.pointerType === "mouse")
          }
          onClick={(event) => {
            if (event.detail === 0) setPickerAutoFocus(true);
            togglePicker(event.currentTarget);
          }}
        >
          <Icon name="smiley" size={16} />
        </button>
      </div>

      <form
        className="acc-mood"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="sr-only" htmlFor="acc-mood-field">
          {t("account.yourStatus")}
        </label>
        <textarea
          id="acc-mood-field"
          value={draft}
          rows={2}
          maxLength={STATUS_MAX_LENGTH}
          placeholder={t("account.statusPlaceholder")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              save();
            }
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="acc-save"
          aria-label={t("common.save")}
          title={showsSaved ? t("common.saved") : t("common.save")}
          disabled={!dirty}
        >
          <Icon name={showsSaved ? "tick" : "send"} size={15} />
        </button>
      </form>

      {pickerAnchor === null ? null : (
        <AnchoredCard
          anchor={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          label={t("account.chooseEmoji")}
          className="acc-emoji-card"
          autoFocus={pickerAutoFocus}
        >
          <EmojiPicker
            customEmoji={customEmoji}
            autoFocus={pickerAutoFocus}
            onPick={(entry) => {
              toggleLeading(
                entry.imageUrl === undefined
                  ? entry.glyph
                  : `:${entry.shortcode}:`,
              );
              setPickerAnchor(null);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        </AnchoredCard>
      )}
    </section>
  );
}

/**
 * The compact menu for frequent account actions: a short status, presence,
 * settings and sign-out. The full profile editor lives in AccountPane.
 */
export function AccountPanel({
  presence,
  customStatus,
  customEmoji = [],
  onSetPresence,
  onSaveCustomStatus,
  onOpenSettings,
  onLogout,
}: AccountPanelProps) {
  const { t } = useLanguage();

  return (
    <>
      <StatusEditor
        customStatus={customStatus}
        customEmoji={customEmoji}
        onSave={onSaveCustomStatus}
      />

      <div
        className="acc-states"
        role="group"
        aria-label={t("account.yourAvailability")}
      >
        {PRESENCE_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            className={value === presence ? "acc-state on" : "acc-state"}
            aria-pressed={value === presence}
            onClick={() => onSetPresence(value)}
          >
            <PresenceDot presence={value} />
            <span className="acc-state-label">
              {t(SELF_PRESENCE_LABEL[value])}
            </span>
          </button>
        ))}
      </div>

      <div className="acc-foot">
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          aria-label={t("common.openSettings")}
          title={t("common.openSettings")}
          onClick={onOpenSettings}
        >
          <Icon name="gear" size={16} />
        </Button>
        <Button
          type="button"
          variant="quiet"
          size="icon-sm"
          className="acc-out"
          aria-label={t("common.logout")}
          title={t("common.logout")}
          onClick={onLogout}
        >
          <Icon name="signout" size={16} />
        </Button>
      </div>
    </>
  );
}
