"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@stellarr/ui/icons";
import { type InterfaceLocale, type Translator } from "@/i18n";
import { documentLocale, translateForDocument } from "@/i18n/defaultLocale";
import type { CustomEmoji, OpenVoiceMessageCapture } from "@/ports";

import { ComposerChips, type ComposerChip } from "./ComposerChips";
import { ComposerCodeBar, ComposerReplyBar } from "./ComposerBars";
import { ComposerFormatPanel } from "./ComposerFormatPanel";
import { insertMention, type MentionCandidate } from "./composerMentions";
import { insertEmojiAt, toggleMarker } from "./composerText";
import { EmojiPicker } from "./EmojiPicker";
import { GifBrowser } from "./GifBrowser";
import { MentionList, mentionOptionId } from "./MentionList";
import { MESSAGE_MAX_LENGTH } from "./messageLimits";
import { useAutosizedField } from "./useAutosizedField";
import { useComposerDraft } from "./useComposerDraft";
import { useComposerPopovers } from "./useComposerPopovers";
import { useMentionSuggestions } from "./useMentionSuggestions";
import { VoiceRecorder } from "./VoiceRecorder";

export type { MentionCandidate };

const MAX_ATTACHMENTS = 10;

/**
 * What the plus accepts: everything the composer can queue. The narrower lists
 * on the document and picture buttons are shortcuts to one kind, not the only
 * way in.
 */
const ANY_ATTACHMENT = [
  "image/*",
  "video/*",
  "audio/*",
  "application/pdf",
  "application/zip",
  "application/json",
  "text/plain",
  ".docx",
  ".xlsx",
  ".pptx",
].join(",");

export interface ComposerProps {
  /** Bare channel name; the placeholder prefixes it with "#". */
  channelName: string;
  /**
   * Replaces the channel phrasing outright. A conversation is written to a
   * person, not on a channel, so a prefix would not have been enough.
   */
  placeholder?: string;
  /** Changing this scope cancels an open microphone capture. */
  recordingScope?: string | null;
  /**
   * False disables the attachment controls and says why on hover, rather than
   * removing them: a private message has nowhere to upload to yet, and a
   * control that queues a file nothing will ever send is the worse lie.
   */
  attachmentsSupported?: boolean;
  chips: ComposerChip[];
  /**
   * Whose message this one answers, if any. The bar above the field names
   * them; sending is what consumes it, and the host clears it.
   */
  replyingTo?: { id: string; authorName: string; preview: string } | null;
  onCancelReply?(): void;
  /** Text is already trimmed. Chips are the caller's to consume and clear. */
  onSubmit(text: string): Promise<void> | void;
  onRemoveChip(id: string): void;
  onRetryChip(id: string): void;
  onReorderChips(from: number, to: number): void;
  /** Raised on keystrokes so a container can throttle a typing notification. */
  onTyping?(): void;
  onAttach?(files: File[]): void;
  giphyApiKey?: string;
  giphyCustomerId?: string;
  onGif?(pageUrl: string): Promise<void>;
  /** The server's own emoji, offered first in the picker. */
  customEmoji?: readonly CustomEmoji[];
  /** Server members offered after typing @. */
  mentionCandidates?: readonly MentionCandidate[];
  openVoiceMessageMicrophone?: OpenVoiceMessageCapture;
  onSendVoice?(file: File, durationSeconds: number): Promise<void>;
  locale?: InterfaceLocale;
  t?: Translator;
}

export function Composer({
  channelName,
  placeholder,
  recordingScope = channelName,
  attachmentsSupported = true,
  chips,
  replyingTo = null,
  onCancelReply,
  onSubmit,
  onRemoveChip,
  onRetryChip,
  onReorderChips,
  onTyping,
  onAttach,
  giphyApiKey = "",
  giphyCustomerId = "stellarr",
  onGif,
  customEmoji = [],
  mentionCandidates = [],
  openVoiceMessageMicrophone,
  onSendVoice,
  locale = documentLocale(),
  t = translateForDocument,
}: ComposerProps) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [observedScope, setObservedScope] = useState(recordingScope);

  const field = useRef<HTMLTextAreaElement | null>(null);
  const filePicker = useRef<HTMLInputElement | null>(null);
  const mobileActionsId = useId();
  const mentionListId = useId();
  /**
   * Where the caret is, for the picker.
   *
   * Clicking into the panel takes focus off the textarea, and a touch-opened
   * picker never gives it back, so the field's own selection stops following
   * the inserts. It is kept up to date while the field has focus and advanced
   * by hand after each insert.
   */
  const caret = useRef<number | null>(null);

  const {
    emojiOpen,
    setEmojiOpen,
    emojiAutoFocus,
    setEmojiAutoFocus,
    formatOpen,
    setFormatOpen,
    mobileActionsOpen,
    setMobileActionsOpen,
    emojiTrigger,
    emojiPanel,
    formatTrigger,
    formatPanel,
    mobileActionsTrigger,
    mobileActions,
  } = useComposerPopovers();
  const {
    text,
    setText,
    sending,
    sendError,
    clearSendError,
    codeMode,
    setCodeMode,
    codeLanguage,
    setCodeLanguage,
    hasPayload,
    attachmentsBlocked,
    canSend,
    submit,
  } = useComposerDraft({
    chips,
    onSubmit,
    onSent: () => setMobileActionsOpen(false),
    locale,
    t,
  });
  useAutosizedField(field, text, recordingScope);

  const mentions = useMentionSuggestions({
    text,
    candidates: mentionCandidates,
    locale,
    enabled: !codeMode,
  });

  // A recording belongs to the room in which it started. Adjusted during
  // render so the old room's microphone never survives into the new room for
  // a committed frame; unmounting VoiceRecorder releases the capture.
  if (observedScope !== recordingScope) {
    setObservedScope(recordingScope);
    setVoiceOpen(false);
    setMobileActionsOpen(false);
  }

  // Starting a reply puts the cursor where the answer goes. Keyed on the
  // answered message, not on the prop object, which the host rebuilds on every
  // render: depending on that would steal the caret on every keystroke.
  const answering = replyingTo?.id ?? null;
  useEffect(() => {
    if (answering !== null) field.current?.focus();
  }, [answering]);

  const voiceUnavailable =
    onSendVoice === undefined || openVoiceMessageMicrophone === undefined;

  /** Focuses the field and selects once the new text has been rendered into it. */
  const selectLater = (from: number, to = from) => {
    requestAnimationFrame(() => {
      const target = field.current;
      if (target === null) return;
      target.focus();
      target.setSelectionRange(from, to);
    });
  };

  const trackCaret = (position: number) => {
    caret.current = position;
    mentions.track(position);
  };

  const chooseMention = (candidate: MentionCandidate) => {
    if (mentions.mention === null) return;
    const edit = insertMention(text, mentions.mention, candidate.username);
    setText(edit.text);
    trackCaret(edit.selectionEnd);
    onTyping?.();
    selectLater(edit.selectionEnd);
  };

  const openPicker = (accept: string) => {
    const picker = filePicker.current;
    if (picker === null || onAttach === undefined) return;
    picker.accept = accept;
    picker.click();
  };

  const insertEmoji = (glyph: string, restoreFocus: boolean) => {
    const at = caret.current ?? field.current?.selectionStart ?? text.length;
    const edit = insertEmojiAt(text, at, glyph);
    setText(edit.text);
    caret.current = edit.selectionEnd;
    // A touch-opened catalogue is meant for picking several emoji in a row.
    // Focusing the field would raise the software keyboard after the first
    // tap and cover the part of the sheet that is useful.
    if (restoreFocus) selectLater(edit.selectionEnd);
  };

  const applyFormat = (marker: string) => {
    const element = field.current;
    const start = element?.selectionStart ?? caret.current ?? text.length;
    const end = element?.selectionEnd ?? start;
    const edit = toggleMarker(text, start, end, marker);
    if (edit.text.length > MESSAGE_MAX_LENGTH) return;
    setText(edit.text);
    caret.current = edit.selectionEnd;
    setFormatOpen(false);
    selectLater(edit.selectionStart, edit.selectionEnd);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        mentions.step(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (mentions.selected !== undefined) chooseMention(mentions.selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        mentions.dismiss();
        return;
      }
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      const marker = key === "b" ? "**" : key === "i" ? "*" : null;
      if (marker !== null) {
        event.preventDefault();
        applyFormat(marker);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    // An IME candidate list also closes on Enter; sending there would eat the
    // word the user was still composing.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const prompt = placeholder ?? t("composer.toChannel", { channel: channelName });
  const noAttachments = t("composer.noPrivateAttachments");
  const attachmentsFull = chips.length >= MAX_ATTACHMENTS;
  const voiceTitle = !attachmentsSupported
    ? noAttachments
    : hasPayload
      ? t("composer.voiceMustBeSeparate")
      : voiceUnavailable
        ? t("composer.recordingUnavailable")
        : undefined;
  const hasMentionCandidates = mentionCandidates.length > 0;
  const selectedMention = mentions.selected;

  return (
    <form className="composer" onSubmit={submit}>
      {/* On top of the box rather than inside it: the field keeps its own
          height and the answer stays visible while a long message is typed. */}
      {replyingTo === null ? null : (
        <ComposerReplyBar
          authorName={replyingTo.authorName}
          preview={replyingTo.preview}
          onCancel={onCancelReply}
          t={t}
        />
      )}
      <ComposerChips
        chips={chips}
        onRemove={onRemoveChip}
        onRetry={onRetryChip}
        onReorder={onReorderChips}
      />
      {codeMode ? (
        <ComposerCodeBar
          language={codeLanguage}
          onLanguageChange={setCodeLanguage}
          onDisable={() => setCodeMode(false)}
          t={t}
        />
      ) : null}
      <input
        ref={filePicker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length > 0) onAttach?.(files);
        }}
      />
      {voiceOpen && !voiceUnavailable ? (
        <div className="composer-box voice-mode">
          <VoiceRecorder
            openMicrophone={openVoiceMessageMicrophone}
            onCancel={() => {
              setVoiceOpen(false);
              requestAnimationFrame(() => field.current?.focus());
            }}
            onSend={onSendVoice}
          />
        </div>
      ) : (
        <div className="composer-box">
          {mentions.open ? (
            <MentionList
              id={mentionListId}
              label={t("composer.mentionPeople")}
              candidates={mentions.matches}
              selectedIndex={mentions.selectedIndex}
              onChoose={chooseMention}
            />
          ) : null}
          {/* The left slot shapes the text being written; attaching lives with
              the other additions on the right, behind the plus. */}
          <button
            ref={formatTrigger}
            type="button"
            className="comp-lead"
            aria-label={t("composer.format")}
            aria-haspopup="true"
            aria-expanded={formatOpen}
            title={t("composer.format")}
            onClick={() => setFormatOpen((open) => !open)}
          >
            <Icon name="textFormat" size={18} />
          </button>
          <textarea
            ref={field}
            rows={1}
            maxLength={MESSAGE_MAX_LENGTH}
            value={text}
            placeholder={prompt}
            aria-label={prompt}
            role={hasMentionCandidates ? "combobox" : undefined}
            aria-autocomplete={hasMentionCandidates ? "list" : undefined}
            aria-expanded={hasMentionCandidates ? mentions.open : undefined}
            aria-controls={mentions.open ? mentionListId : undefined}
            aria-activedescendant={
              mentions.open && selectedMention !== undefined
                ? mentionOptionId(mentionListId, selectedMention)
                : undefined
            }
            onChange={(event) => {
              setText(event.target.value);
              trackCaret(event.target.selectionStart);
              clearSendError();
              onTyping?.();
            }}
            onSelect={(event) => trackCaret(event.currentTarget.selectionStart)}
            onPaste={(event) => {
              if (!attachmentsSupported || onAttach === undefined) return;
              const files = Array.from(event.clipboardData.files);
              if (files.length === 0) return;
              // Screenshots and copied files belong to the attachment queue. Do
              // not also paste the browser's fallback filename into the draft.
              event.preventDefault();
              onAttach(files);
            }}
            onKeyDown={onKeyDown}
          />
          <button
            ref={mobileActionsTrigger}
            type="button"
            className="attach comp-mobile-more"
            aria-label={t("composer.moreActions")}
            aria-controls={mobileActionsId}
            aria-expanded={mobileActionsOpen}
            onClick={() => setMobileActionsOpen((open) => !open)}
          >
            <Icon name={mobileActionsOpen ? "x" : "plus"} size={18} />
          </button>
          <div
            ref={mobileActions}
            id={mobileActionsId}
            className={mobileActionsOpen ? "comp-actions mobile-open" : "comp-actions"}
            role="toolbar"
            aria-label={t("composer.moreActions")}
          >
            <button
              type="button"
              className="attach comp-code-trigger"
              aria-label={t("composer.sendAsCode")}
              aria-pressed={codeMode}
              title={t("composer.sendAsCode")}
              onClick={() => {
                setCodeMode((enabled) => !enabled);
                setMobileActionsOpen(false);
              }}
            >
              <Icon name="code" size={18} />
            </button>
            <button
              type="button"
              className="attach comp-x"
              aria-label={t("composer.addAttachment")}
              disabled={!attachmentsSupported || attachmentsFull}
              title={
                attachmentsFull
                  ? t("composer.attachmentLimit")
                  : attachmentsSupported
                    ? t("composer.addAttachment")
                    : noAttachments
              }
              onClick={() => {
                setMobileActionsOpen(false);
                openPicker(ANY_ATTACHMENT);
              }}
            >
              <Icon name="plus" size={18} />
            </button>
            {onGif === undefined ? null : (
              <GifBrowser apiKey={giphyApiKey} customerId={giphyCustomerId} onSelect={onGif} />
            )}
            <button
              ref={emojiTrigger}
              type="button"
              className="attach"
              aria-label={t("emoji.open")}
              aria-haspopup="dialog"
              aria-expanded={emojiOpen}
              onPointerDown={(event) => setEmojiAutoFocus(event.pointerType === "mouse")}
              onClick={(event) => {
                // A click from a keyboard or assistive technology has no
                // pointer event before it and carries detail 0.
                if (event.detail === 0) setEmojiAutoFocus(true);
                // Read before the click moves focus off the field.
                caret.current = field.current?.selectionStart ?? null;
                setEmojiOpen(!emojiOpen);
                if (!emojiOpen) setMobileActionsOpen(false);
              }}
            >
              <Icon name="smiley" size={18} />
            </button>
            <button
              type="button"
              className="attach comp-x"
              aria-label={t("composer.recordVoice")}
              disabled={!attachmentsSupported || hasPayload || sending || voiceUnavailable}
              title={voiceTitle}
              onClick={() => {
                setMobileActionsOpen(false);
                setVoiceOpen(true);
              }}
            >
              <Icon name="mic" size={18} />
            </button>
          </div>
          {/* Disabled is not only a guard: `.send:disabled` collapses the button
              to zero width, which is how the empty composer looks. */}
          <button
            type="submit"
            className={
              sending
                ? "send sending"
                : hasPayload && attachmentsBlocked
                  ? "send waiting"
                  : "send"
            }
            disabled={!canSend}
            aria-label={
              sending
                ? t("composer.sending")
                : attachmentsBlocked
                  ? t("composer.waitForAttachments")
                  : t("composer.send")
            }
            aria-busy={sending}
          >
            <Icon name="send" size={15} />
          </button>
        </div>
      )}
      {/* Outside `.composer-box`, so they are positioned against the form that
          `.fmt-pop` and `.emo-pop` anchor to; inside, the box's own rounding
          would clip them. */}
      {formatOpen ? (
        <ComposerFormatPanel panelRef={formatPanel} onFormat={applyFormat} t={t} />
      ) : null}
      {emojiOpen ? (
        <div className="emo-pop" ref={emojiPanel} role="dialog" aria-label={t("emoji.search")}>
          {/* The panel stays open after a pick: sending three emoji in a row is
              the common case. A Unicode emoji goes in as itself, which every
              reader renders; an uploaded one goes in as `:code:`, the only way a
              message body can carry a picture that lives on the server. */}
          <EmojiPicker
            customEmoji={customEmoji}
            autoFocus={emojiAutoFocus}
            onPick={(entry) =>
              insertEmoji(
                entry.imageUrl === undefined ? entry.glyph : `:${entry.shortcode}:`,
                emojiAutoFocus,
              )
            }
            onClose={() => {
              setEmojiOpen(false);
              emojiTrigger.current?.focus();
            }}
          />
        </div>
      ) : null}
      {sendError === null ? null : (
        <p className="composer-error" role="alert">
          {sendError}
        </p>
      )}
    </form>
  );
}
