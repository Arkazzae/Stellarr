"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { SettingsSection } from "@/components/settings/SettingsSection";
import type { CustomEmoji } from "@/ports";
import { useLanguage } from "@/state/hooks";

const MAX_EMOJI = 100;
const MAX_BYTES = 512 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const SHORTCODE = /^[a-z0-9_]{2,32}$/;

/** Shortcodes arrive both bare and already wrapped in colons. */
function withColons(shortcode: string): string {
  return `:${shortcode.replace(/^:|:$/g, "")}:`;
}

/** Keeps only what a shortcode may contain, as someone types it. */
function sanitiseShortcode(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
}

/** "Party Frog.png" suggests `party_frog`; a name with nothing usable gets `emoji`. */
function suggestShortcode(file: File): string {
  const suggestion = file.name
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return suggestion.length >= 2 ? suggestion : "emoji";
}

interface Draft {
  file: File;
  previewUrl: string;
  shortcode: string;
}

interface UploadEditorProps {
  draft: Draft;
  busy: boolean;
  onShortcodeChange: (shortcode: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function UploadEditor({
  draft,
  busy,
  onShortcodeChange,
  onSubmit,
  onCancel,
}: UploadEditorProps) {
  const { t } = useLanguage();
  const valid = SHORTCODE.test(draft.shortcode);

  return (
    <section className="sc emoji-editor-card" aria-busy={busy}>
      <header className="sc-h">
        {t("common.add")} emoji
      </header>
      <div className="sc-b emoji-editor-body">
        <div className="emoji-editor-fields">
          <div className="emoji-upload-preview" aria-label={t("settings.emojiPreview")}>
            <img src={draft.previewUrl} alt="" width={56} height={56} />
          </div>
          <label>
            <span className="fld-lab">{t("settings.emojiName").toUpperCase()}</span>
            <span className="emoji-code-field">
              <i>:</i>
              <input
                className="set-input"
                value={draft.shortcode}
                maxLength={32}
                autoFocus
                aria-label={t("settings.emojiName")}
                aria-describedby="emoji-name-help"
                disabled={busy}
                onChange={(event) => onShortcodeChange(sanitiseShortcode(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !valid) return;
                  event.preventDefault();
                  onSubmit();
                }}
              />
              <i>:</i>
            </span>
            <span className="emoji-file-name">{draft.file.name}</span>
          </label>
        </div>
        <p className="fld-note" id="emoji-name-help">
          {t("settings.emojiNameHelp")}
        </p>
        <div className="emoji-editor-actions">
          <span />
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="emoji-save"
            disabled={busy || !valid}
            onClick={onSubmit}
          >
            {busy ? `${t("common.add")}…` : `${t("common.save")} emoji`}
          </Button>
        </div>
      </div>
    </section>
  );
}

export interface EmojiPaneProps {
  supported: boolean;
  emoji: readonly CustomEmoji[];
  onUpload: (shortcode: string, file: File) => Promise<void>;
  onDelete: (emojiId: string) => Promise<void>;
}

export function EmojiPane({ supported, emoji, onUpload, onDelete }: EmojiPaneProps) {
  const { t } = useLanguage();
  const confirm = useConfirm();
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The preview URL is revoked whenever it is replaced, and on unmount.
  const previewUrl = draft?.previewUrl;
  useEffect(
    () => () => {
      if (previewUrl !== undefined) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const closeEditor = () => {
    setDraft(null);
    setError(null);
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again still fires a change.
    event.target.value = "";
    if (file === undefined) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setError(t("settings.emojiFileType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("settings.emojiFileSize"));
      return;
    }
    setDraft({ file, previewUrl: URL.createObjectURL(file), shortcode: suggestShortcode(file) });
    setError(null);
  };

  const upload = async () => {
    if (draft === null || !SHORTCODE.test(draft.shortcode)) return;
    setUploading(true);
    setError(null);
    try {
      await onUpload(draft.shortcode, draft.file);
      closeEditor();
    } catch {
      setError(t("settings.emojiAddFailed"));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (item: CustomEmoji) => {
    const name = withColons(item.shortcode);
    const confirmed = await confirm({
      title: t("settings.emojiDeleteTitle", { name }),
      description: t("settings.emojiDeleteDescription"),
      confirmLabel: t("common.remove"),
      danger: true,
      icon: "trash",
    });
    if (!confirmed) return;
    setDeletingId(item.id);
    setError(null);
    try {
      await onDelete(item.id);
    } catch {
      setError(t("settings.emojiRemoveFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const atLimit = emoji.length >= MAX_EMOJI;

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.emojiUnsupported")}</p>}
      {error === null ? null : (
        <p className="set-note emoji-error" role="alert">
          {error}
        </p>
      )}

      <SettingsSection
        title={t("server.emoji")}
        count={`${emoji.length}/${MAX_EMOJI}`}
        countLabel={t("settings.emojiCount", { count: emoji.length, max: MAX_EMOJI })}
        action={
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="asset-add"
              disabled={!supported || uploading || deletingId !== null || atLimit}
              title={atLimit ? t("settings.emojiLimitTitle") : undefined}
              onClick={() => picker.current?.click()}
            >
              <Icon name="plus" size={15} />
              {t("settings.addEmoji")}
            </Button>
            <input
              ref={picker}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              hidden
              onChange={choose}
            />
          </>
        }
      >
        {emoji.length === 0 ? (
          <div className="asset-empty">
            <Icon name="smiley" size={24} />
            <b>{t("settings.noEmoji")}</b>
            <span>{t("settings.noEmojiDetail")}</span>
          </div>
        ) : (
          <div className="emo-grid emoji-grid" role="list">
            {emoji.map((item) => {
              const name = withColons(item.shortcode);
              return (
                <div
                  key={item.id}
                  className={`emo-tile emoji-tile${supported ? " editable" : ""}`}
                  role="listitem"
                  aria-busy={deletingId === item.id}
                >
                  <span className="emoji-glyph" aria-hidden="true">
                    <img src={item.glyph} alt="" width={40} height={40} loading="lazy" />
                  </span>
                  <span className="emoji-name">{name}</span>
                  {supported ? (
                    <button
                      type="button"
                      className="emoji-delete"
                      disabled={deletingId !== null}
                      aria-label={t("settings.deleteEmoji", { name })}
                      onClick={() => void remove(item)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {atLimit ? (
          <p className="fld-note emoji-limit-note">
            {t("settings.emojiLimit", { count: MAX_EMOJI })}
          </p>
        ) : null}
      </SettingsSection>

      {draft === null ? null : (
        <UploadEditor
          draft={draft}
          busy={uploading}
          onShortcodeChange={(shortcode) => setDraft({ ...draft, shortcode })}
          onSubmit={() => void upload()}
          onCancel={closeEditor}
        />
      )}
    </>
  );
}
