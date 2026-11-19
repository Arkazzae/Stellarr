import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/icons";
import { AnchoredCard } from "@/components/primitives/AnchoredCard";
import { EmojiPicker } from "@/components/emoji/EmojiPicker";
import { WaveformTrimmer, type DecodedWaveform } from "@/components/settings/sound/WaveformTrimmer";
import { useLanguage } from "@/state/hooks";

export const DEFAULT_SOUND_GLYPH = "🔊";

export const MAX_SOUND_NAME_LENGTH = 32;

/** A clip being added (`file`) or re-trimmed (`id`), with the edits so far. */
export interface SoundDraft extends DecodedWaveform {
  /** Which load produced this draft; a new one starts with a fresh editor. */
  revision: number;
  id: string | null;
  file: File | null;
  previewUrl: string;
  name: string;
  glyph: string;
  start: number;
  end: number;
}

export type SoundEdit = Partial<Pick<SoundDraft, "name" | "glyph" | "start" | "end">>;

export function canSaveSound(draft: SoundDraft): boolean {
  return (
    draft.name.trim() !== "" &&
    draft.glyph.trim() !== "" &&
    Number.isFinite(draft.start) &&
    Number.isFinite(draft.end) &&
    draft.end > draft.start
  );
}

export interface SoundEditorProps {
  draft: SoundDraft;
  busy: boolean;
  /** Whether the draft's clip is being auditioned. */
  previewing: boolean;
  /** Seconds as the pane writes them, such as "1,2 s". */
  formatSeconds: (seconds: number) => string;
  onEdit: (edit: SoundEdit) => void;
  /** Starts the trimmed clip, or stops it while it plays. */
  onPreview: () => void;
  onSave: () => void;
  onClose: () => void;
}

/**
 * One sound on a page of its own inside the pane: back to the list, its
 * symbol and name, the stretch of the clip that plays, and saving.
 */
export function SoundEditor({
  draft,
  busy,
  previewing,
  formatSeconds,
  onEdit,
  onPreview,
  onSave,
  onClose,
}: SoundEditorProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const nameId = useId();
  const countId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  // A picker opened by touch must not raise the software keyboard.
  const [emojiAutoFocus, setEmojiAutoFocus] = useState(true);
  const glyph = draft.glyph || DEFAULT_SOUND_GLYPH;
  const source =
    draft.file === null
      ? t("settings.soundSource", { seconds: formatSeconds(draft.duration) })
      : t("settings.soundFile", { name: draft.file.name, seconds: formatSeconds(draft.duration) });

  // The list this page replaced held focus; it starts here, on the title, so
  // that the page is announced and the pane shows its top.
  useEffect(() => {
    title.current?.focus();
  }, []);

  // A symbol picked while the draft is being saved would land on a draft that
  // is about to close.
  if (busy && emojiAnchor !== null) setEmojiAnchor(null);

  return (
    <>
      <section className="sound-editor" aria-labelledby={titleId}>
        <button type="button" className="sound-back" disabled={busy} onClick={onClose}>
          <Icon name="caretL" size={16} />
          {t("settings.allSounds")}
        </button>
        <h3 id={titleId} className="sound-editor-title" tabIndex={-1} ref={title}>
          {draft.id === null ? t("settings.newSound") : t("settings.soundEditor")}
        </h3>

        <div className="sound-fields">
          <div className="sound-field">
            <span className="sound-label" aria-hidden="true">
              {t("settings.soundSymbol")}
            </span>
            {/* The control is the emoji itself: a text box asked people to type
                a character they had to find elsewhere first. */}
            <button
              type="button"
              className="sound-glyph-pick"
              aria-label={t("settings.chooseSoundEmoji")}
              aria-haspopup="dialog"
              aria-expanded={emojiAnchor !== null}
              title={t("settings.chooseSoundEmoji")}
              disabled={busy}
              onPointerDown={(event) => setEmojiAutoFocus(event.pointerType === "mouse")}
              onClick={(event) => {
                // A click without a pointer is the keyboard.
                if (event.detail === 0) setEmojiAutoFocus(true);
                const button = event.currentTarget;
                setEmojiAnchor((open) => (open === null ? button : null));
              }}
            >
              {glyph}
            </button>
          </div>
          <div className="sound-field grow">
            <label className="sound-label" htmlFor={nameId}>
              {t("settings.soundName")}
            </label>
            <span className="sound-name-field">
              <input
                id={nameId}
                className="set-input"
                value={draft.name}
                maxLength={MAX_SOUND_NAME_LENGTH}
                disabled={busy}
                aria-describedby={countId}
                onChange={(event) => onEdit({ name: event.target.value })}
              />
              <small id={countId}>
                {draft.name.length}/{MAX_SOUND_NAME_LENGTH}
              </small>
            </span>
          </div>
        </div>

        <div className="sound-clip">
          <div className="sound-clip-head">
            <span className="sound-label">{t("settings.soundClip")}</span>
            <span className="sound-source">{source}</span>
          </div>
          <WaveformTrimmer
            duration={draft.duration}
            peaks={draft.peaks}
            start={draft.start}
            end={draft.end}
            disabled={busy}
            onChange={(start, end) => onEdit({ start, end })}
          />
          <div className="sound-times">
            <span>
              {t("settings.soundStart")} <b>{formatSeconds(draft.start)}</b>
            </span>
            <span>
              {t("settings.soundLength")} <b>{formatSeconds(draft.end - draft.start)}</b>
            </span>
            <span>
              {t("settings.soundEnd")} <b>{formatSeconds(draft.end)}</b>
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={onPreview} disabled={busy}>
              <Icon name={previewing ? "stop" : "play"} size={14} />
              {previewing ? t("settings.soundPreviewStop") : t("settings.soundPreview")}
            </Button>
          </div>
        </div>

        <div className="sound-editor-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSave}
            disabled={busy || !canSaveSound(draft)}
          >
            {busy ? t("common.saving") : t("settings.soundSave")}
          </Button>
        </div>
      </section>

      {emojiAnchor === null ? null : (
        <AnchoredCard
          anchor={emojiAnchor}
          onClose={() => setEmojiAnchor(null)}
          label={t("settings.chooseSoundEmoji")}
          className="sound-emoji-card"
          autoFocus={emojiAutoFocus}
        >
          <EmojiPicker
            autoFocus={emojiAutoFocus}
            onPick={(entry) => {
              onEdit({ glyph: entry.glyph });
              setEmojiAnchor(null);
            }}
            onClose={() => setEmojiAnchor(null)}
          />
        </AnchoredCard>
      )}
    </>
  );
}
