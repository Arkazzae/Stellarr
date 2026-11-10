"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Translator } from "@/i18n";

import { MESSAGE_MAX_LENGTH } from "./messageLimits";

/** How tall the field may grow before it scrolls: eight lines, like the composer. */
const MAX_HEIGHT_PX = 8 * 24;

export interface MessageEditorProps {
  /** What the message says now; the field starts from it. */
  original: string;
  /** A rejection keeps the editor open with the text intact and says it failed. */
  onSave(text: string): Promise<void> | void;
  onCancel(): void;
  t: Translator;
}

/**
 * A message being rewritten in the place it sits.
 *
 * Its own component so the draft dies with it: closing the editor and opening
 * it again starts from what the message actually says, never from an abandoned
 * attempt. Which message is being edited belongs to the provider, and arrives
 * as `original`.
 *
 * The keys are the composer's, because this is still writing a message: Enter
 * saves, Shift+Enter breaks a line, Escape gives up. Escape is stopped here so
 * it does not also close whatever is behind the transcript.
 */
export function MessageEditor({ original, onSave, onCancel, t }: MessageEditorProps) {
  const [text, setText] = useState(original);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  // Caret at the end, nothing selected: a selected body would be wiped by the
  // first keystroke of somebody who came to change one word.
  useEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // Grows with the text: an editor that scrolls inside three lines is worse
  // than the message it replaced.
  useLayoutEffect(() => {
    const element = field.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const empty = text.trim().length === 0;

  const save = async () => {
    // Emptying a message is deleting it, and there is a bin for that.
    if (empty) return;
    const next = text.trim();
    if (next === original.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await onSave(next);
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <div className="msg-edit">
      <textarea
        ref={field}
        className="msg-edit-field"
        rows={1}
        maxLength={MESSAGE_MAX_LENGTH}
        value={text}
        aria-label={t("message.edit.label")}
        disabled={saving}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            // Enter also closes an IME candidate list; saving then would eat
            // the word still being composed.
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="msg-edit-foot">
        <span className="msg-edit-hint">{t("message.edit.hint")}</span>
        <button type="button" className="msg-edit-x" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="msg-edit-ok"
          disabled={saving || empty}
          onClick={() => void save()}
        >
          {t("common.save")}
        </button>
      </div>
      {failed ? (
        <p className="acc-answer bad" role="alert">
          {t("message.edit.failed")}
        </p>
      ) : null}
    </div>
  );
}
