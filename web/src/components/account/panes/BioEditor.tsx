"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import { ProfileBioText } from "@/components/profile/ProfileBio";
import { EmojiPicker } from "@/components/room/EmojiPicker";
import type { CustomEmoji } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** The same cap the bio column leaves room above; see `AppDbContext`. */
const BIO_MAX = 2000;

interface Range {
  start: number;
  end: number;
}

interface BioEditorProps {
  value: string;
  customEmoji: readonly CustomEmoji[];
  onChange: (value: string) => void;
}

/**
 * The "about me" row of the profile form: a plain textarea with just enough
 * formatting to write what the profile renders (bold, italic, links, emoji),
 * and a preview that shows it the way the card will.
 */
export function BioEditor({ value, customEmoji, onChange }: BioEditorProps) {
  const { t } = useLanguage();
  const labelId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const emojiTrigger = useRef<HTMLButtonElement>(null);
  const emojiPanel = useRef<HTMLDivElement>(null);
  // The textarea loses its selection when the picker takes focus, so the
  // range is taken when the picker opens.
  const emojiRange = useRef<Range | null>(null);

  const [preview, setPreview] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Opening the picker by touch must not raise the keyboard of either field.
  const [emojiAutoFocus, setEmojiAutoFocus] = useState(true);

  useEffect(() => {
    if (!emojiOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (emojiPanel.current?.contains(target)) return;
      if (emojiTrigger.current?.contains(target)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [emojiOpen]);

  const selection = (): Range => {
    const start = field.current?.selectionStart ?? value.length;
    return { start, end: field.current?.selectionEnd ?? start };
  };

  const selectRange = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const target = field.current;
      if (target === null) return;
      target.focus();
      target.setSelectionRange(start, end);
    });
  };

  /** Replaces a range, unless the result would not fit in the column. */
  const splice = ({ start, end }: Range, inserted: string): boolean => {
    const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`;
    if (next.length > BIO_MAX) return false;
    onChange(next);
    return true;
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const range = selection();
    const content = value.slice(range.start, range.end) || placeholder;
    if (!splice(range, `${before}${content}${after}`)) return;
    setPreview(false);
    const from = range.start + before.length;
    selectRange(from, from + content.length);
  };

  const insertLink = () => {
    const range = selection();
    const selected = value.slice(range.start, range.end);
    const isUrl = /^https?:\/\/\S+$/i.test(selected);
    const label = isUrl ? "link" : selected || t("account.linkDescription");
    const href = isUrl ? selected : "https://";
    if (!splice(range, `[${label}](${href})`)) return;
    setPreview(false);
    // Leaves the address selected, ready to be typed over.
    const hrefStart = range.start + label.length + 3;
    selectRange(hrefStart, hrefStart + href.length);
  };

  const insertEmoji = (glyph: string) => {
    const range = emojiRange.current ?? selection();
    if (!splice(range, glyph)) return;
    setEmojiOpen(false);
    emojiRange.current = null;
    if (emojiAutoFocus) {
      const caret = range.start + glyph.length;
      selectRange(caret, caret);
    } else {
      requestAnimationFrame(() => emojiTrigger.current?.focus());
    }
  };

  const toggleEmoji = (fromKeyboard: boolean) => {
    if (fromKeyboard) setEmojiAutoFocus(true);
    emojiRange.current = selection();
    setEmojiOpen((open) => !open);
  };

  const previewLabel = preview
    ? t("account.backToEditing")
    : t("account.showPreview");

  return (
    <div className="frm-row">
      <div className="frm-lab" id={labelId}>
        {t("account.aboutMe")}
        <span>{t("account.bioDetail")}</span>
      </div>
      <div className="frm-ctl">
        <div className="pf-bio-wrap">
          <div className="pf-bio-editor">
            <div
              className="pf-bio-tools"
              role="toolbar"
              aria-label={t("account.formatting")}
            >
              <button
                type="button"
                className="pf-format"
                aria-label={t("account.bold")}
                title={t("account.bold")}
                disabled={preview}
                onClick={() => wrapSelection("**", "**", t("account.bold"))}
              >
                <Icon name="bold" size={17} />
              </button>
              <button
                type="button"
                className="pf-format"
                aria-label={t("account.italic")}
                title={t("account.italic")}
                disabled={preview}
                onClick={() => wrapSelection("*", "*", t("account.italic"))}
              >
                <Icon name="italic" size={17} />
              </button>
              <button
                type="button"
                className="pf-format"
                aria-label={t("account.addLink")}
                title={t("account.addLink")}
                disabled={preview}
                onClick={insertLink}
              >
                <Icon name="link" size={16} />
              </button>
              <button
                ref={emojiTrigger}
                type="button"
                className={emojiOpen ? "pf-format on" : "pf-format"}
                aria-label={t("account.addEmoji")}
                title={t("account.addEmoji")}
                aria-haspopup="dialog"
                aria-expanded={emojiOpen}
                disabled={preview}
                onPointerDown={(event) =>
                  setEmojiAutoFocus(event.pointerType === "mouse")
                }
                // A click with no pointer (`detail` 0) is the keyboard.
                onClick={(event) => toggleEmoji(event.detail === 0)}
              >
                <Icon name="smiley" size={17} />
              </button>
              <span className="pf-tool-spacer" />
              <button
                type="button"
                className={preview ? "pf-format on" : "pf-format"}
                aria-label={previewLabel}
                title={previewLabel}
                aria-pressed={preview}
                onClick={() => {
                  setPreview((shown) => !shown);
                  setEmojiOpen(false);
                }}
              >
                <Icon name="eye" size={17} />
              </button>
            </div>

            {preview ? (
              <div
                className="pf-bio-preview-text"
                aria-label={t("account.preview")}
              >
                {value.trim().length === 0 ? (
                  <span>{t("account.emptyBio")}</span>
                ) : (
                  <p>
                    <ProfileBioText text={value} customEmoji={customEmoji} />
                  </p>
                )}
              </div>
            ) : (
              <textarea
                ref={field}
                aria-labelledby={labelId}
                className="set-area pf-bio"
                placeholder={t("account.bioQuestion")}
                value={value}
                rows={6}
                maxLength={BIO_MAX}
                onChange={(event) => onChange(event.target.value)}
              />
            )}

            <div className="pf-bio-meta">
              <span>{t("account.bioFormattingHint")}</span>
              <span className="pf-bio-count">
                {value.length}/{BIO_MAX}
              </span>
            </div>
          </div>

          {emojiOpen ? (
            <div
              ref={emojiPanel}
              className="pf-emoji-pop"
              role="dialog"
              aria-label={t("account.chooseEmoji")}
            >
              <EmojiPicker
                customEmoji={customEmoji}
                autoFocus={emojiAutoFocus}
                onPick={(entry) =>
                  insertEmoji(
                    entry.imageUrl === undefined
                      ? entry.glyph
                      : `:${entry.shortcode}:`,
                  )
                }
                onClose={() => {
                  setEmojiOpen(false);
                  emojiTrigger.current?.focus();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
