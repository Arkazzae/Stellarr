"use client";

import { useId, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { AnchoredCard } from "@/components/primitives/AnchoredCard";
import { EmojiPicker } from "@/components/room/EmojiPicker";
import { WaveformTrimmer, type DecodedWaveform } from "@/components/settings/WaveformTrimmer";
import { useLanguage } from "@/state/hooks";

export const DEFAULT_SOUND_GLYPH = "🔊";

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
  soundboardVolume: number;
  onSoundboardVolumeChange: (volume: number) => void;
  onEdit: (edit: SoundEdit) => void;
  onPreview: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function SoundEditor({
  draft,
  busy,
  soundboardVolume,
  onSoundboardVolumeChange,
  onEdit,
  onPreview,
  onSave,
  onClose,
}: SoundEditorProps) {
  const { t } = useLanguage();
  const nameId = useId();
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  // A picker opened by touch must not raise the software keyboard.
  const [emojiAutoFocus, setEmojiAutoFocus] = useState(true);
  const glyph = draft.glyph || DEFAULT_SOUND_GLYPH;

  // A load that is under way replaces this draft, so a symbol picked in the
  // meantime would land on a draft that is thrown away.
  if (busy && emojiAnchor !== null) setEmojiAnchor(null);

  return (
    <>
      <section className="sc sc-b sound-editor-card" aria-labelledby="sound-editor-title">
        <header className="sound-editor-head">
          <span className="sound-editor-mark" aria-hidden="true">
            {glyph}
          </span>
          <span>
            <b id="sound-editor-title">
              {draft.id === null ? t("settings.newSound") : t("settings.soundEditor")}
            </b>
            <small>{t("settings.soundEditorDetail")}</small>
          </span>
          <button
            type="button"
            className="sound-editor-close"
            aria-label={t("settings.closeSoundEditor")}
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="sound-fields">
          <div className="sound-field">
            <span className="sound-field-label" aria-hidden="true">
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
              <span className="sound-glyph-face" aria-hidden="true">
                {glyph}
              </span>
              <Icon name="smiley" size={15} className="sound-glyph-hint" />
            </button>
          </div>
          <div className="sound-field">
            <label htmlFor={nameId}>{t("settings.soundName")}</label>
            <input
              id={nameId}
              className="set-input"
              value={draft.name}
              maxLength={32}
              disabled={busy}
              onChange={(event) => onEdit({ name: event.target.value })}
            />
          </div>
        </div>

        <div className="sound-wave-head">
          <span>
            <b>{t("settings.soundClip")}</b>
            <small>{t("settings.soundClipDetail")}</small>
          </span>
          {/* The level the clip is auditioned at belongs beside the button, and
              it is the soundboard level the call plays it through, not a second
              dial to forget. */}
          <label className="sound-preview-volume">
            <Icon name="speaker" size={14} />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={soundboardVolume}
              aria-label={t("voice.soundboardVolume")}
              onChange={(event) => onSoundboardVolumeChange(Number(event.target.value))}
            />
            <output>{soundboardVolume}%</output>
          </label>
          <button type="button" className="btn-ghost sm" onClick={onPreview} disabled={busy}>
            <Icon name="play" size={14} /> {t("settings.soundPreview")}
          </button>
        </div>
        <WaveformTrimmer
          duration={draft.duration}
          peaks={draft.peaks}
          start={draft.start}
          end={draft.end}
          disabled={busy}
          onChange={(start, end) => onEdit({ start, end })}
        />

        <div className="sound-editor-actions">
          <button type="button" className="btn-ghost sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary sm"
            onClick={onSave}
            disabled={busy || !canSaveSound(draft)}
          >
            {busy ? t("common.saving") : t("settings.soundSave")}
          </button>
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
