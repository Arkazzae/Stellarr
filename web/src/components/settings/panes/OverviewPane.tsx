"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
import { Switch } from "@/components/primitives/Switch";
import { countedNoun, formatShortDate } from "@/components/settings/panes/paneFormat";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import type { Translator } from "@/i18n";
import type { ServerPatch } from "@/ports";
import { useLanguage } from "@/state/hooks";

const ICON_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_ICON_BYTES = 4 * 1024 * 1024;
const SAVED_FLASH_MS = 1500;

export interface OverviewPaneProps {
  supported: boolean;
  iconSupported: boolean;
  name: string;
  /** Two-letter mark, drawn beside the name at the top of this pane. */
  mark: string;
  iconUrl?: string;
  /** ISO 8601. Absent only in legacy development fixtures. */
  createdAt?: string;
  memberCount: number;
  channelCount: number;
  description: string;
  isPublic: boolean;
  onSave: (patch: ServerPatch) => Promise<void>;
  onPickIcon: (file: File) => Promise<void>;
  onRemoveIcon: () => Promise<void>;
}

interface Profile {
  name: string;
  description: string;
  isPublic: boolean;
}

function sameProfile(a: Profile, b: Profile): boolean {
  return a.name === b.name && a.description === b.description && a.isPublic === b.isPublic;
}

/**
 * Picking and removing the server icon.
 *
 * A picked file is checked here, before the backend hears of it, and shown from
 * a blob URL while the upload runs. The URL is revoked once it is replaced and
 * when the pane goes away.
 */
function useServerIcon(
  t: Translator,
  onPick: (file: File) => Promise<void>,
  onRemove: () => Promise<void>,
) {
  const action = useAsyncAction();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pick = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    if (!ICON_TYPES.includes(file.type)) {
      setError(t("settings.serverIconFormat"));
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setError(t("settings.serverIconSize"));
      return;
    }
    setPreview(URL.createObjectURL(file));
    const stored = await action.run(() => onPick(file));
    setPreview(null);
    if (!stored) setError(t("settings.serverIconSaveFailed"));
  };

  const remove = async () => {
    setError(null);
    if (!(await action.run(onRemove))) setError(t("settings.serverIconRemoveFailed"));
  };

  return { busy: action.pending, error, preview, pick, remove };
}

export function OverviewPane({
  supported,
  iconSupported,
  name,
  mark,
  iconUrl,
  createdAt,
  memberCount,
  channelCount,
  description,
  isPublic,
  onSave,
  onPickIcon,
  onRemoveIcon,
}: OverviewPaneProps) {
  const { locale, t } = useLanguage();
  const icon = useServerIcon(t, onPickIcon, onRemoveIcon);
  const saveAction = useAsyncAction();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);
  const iconInput = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const descriptionId = useId();

  // Typing needs no round trip, so the fields are a local draft. It is re-seeded
  // when the saved profile changes underneath, which is what a rejected save
  // looks like from here. Comparing during render, rather than in an effect,
  // paints the re-seeded fields in one pass.
  const profile: Profile = { name, description, isPublic };
  const [draft, setDraft] = useState(profile);
  const [seed, setSeed] = useState(profile);
  if (!sameProfile(seed, profile)) {
    setSeed(profile);
    setDraft(profile);
  }

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const save = async () => {
    const stored = await saveAction.run(() =>
      onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        isPublic: draft.isPublic,
      }),
    );
    if (!stored) return;
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  };

  // Disabled until something changed: a button that is always live cannot tell
  // the reader whether they have unsaved work.
  const dirty =
    draft.name.trim() !== name.trim() ||
    draft.description.trim() !== description.trim() ||
    draft.isPublic !== isPublic;

  const shownIcon = icon.preview ?? iconUrl;
  const iconLocked = !iconSupported || icon.busy;
  const openPicker = () => iconInput.current?.click();

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.serverUnsupported")}</p>}

      <SettingsSection
        title={t("settings.serverProfile")}
        className="overview-section"
      >
        <header className="ov-id">
          <button
            type="button"
            className="ov-id-ico"
            disabled={iconLocked}
            aria-label={
              iconUrl === undefined ? t("settings.serverIconAdd") : t("settings.serverIconChange")
            }
            onClick={openPicker}
          >
            {shownIcon ? <img src={shownIcon} alt="" width={44} height={44} /> : mark}
            <span className="ov-icon-veil" aria-hidden="true">
              <Icon name="camera" size={15} />
            </span>
          </button>
          <input
            ref={iconInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(event) => {
              void icon.pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <span className="ov-id-txt">
            <b>{name}</b>
            <span>
              {t("settings.createdInfo", {
                date: createdAt === undefined ? "—" : formatShortDate(createdAt, locale),
                members: countedNoun(t, locale, "settings.member", memberCount),
                channels: countedNoun(t, locale, "settings.channel", channelCount),
              })}
            </span>
          </span>
          <span className="ov-icon-actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={iconLocked}
              onClick={openPicker}
            >
              <Icon name="image" size={14} />
              {icon.busy
                ? t("common.saving")
                : iconUrl === undefined
                  ? t("settings.serverIconAddShort")
                  : t("settings.serverIconChangeShort")}
            </Button>
            {iconUrl === undefined ? null : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="danger"
                disabled={iconLocked}
                onClick={() => void icon.remove()}
              >
                {t("settings.serverIconRemove")}
              </Button>
            )}
          </span>
        </header>

        <p className="ov-icon-note">{t("settings.iconNote")}</p>
        {icon.error === null ? null : (
          <p className="set-note sound-error" role="alert">
            {icon.error}
          </p>
        )}

        <div className="frm">
          <div className="frm-row">
            <label className="frm-lab" htmlFor={nameId}>
              {t("channel.name")}
              <span>{t("settings.serverNameDetail")}</span>
            </label>
            <div className="frm-ctl">
              <input
                id={nameId}
                className="set-input"
                type="text"
                value={draft.name}
                maxLength={80}
                disabled={!supported}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
          </div>

          <div className="frm-row">
            {/* The label is the on state, not a category: "Visibility" would not
                say which way the switch has to be turned. */}
            <span className="frm-lab">
              {t("settings.publicServer")}
              <span>{t("settings.publicServerDetail")}</span>
            </span>
            <div className="frm-ctl frm-switch">
              <Switch
                checked={draft.isPublic}
                onChange={(checked) => setDraft({ ...draft, isPublic: checked })}
                label={t("settings.publicServer")}
                disabled={!supported}
              />
            </div>
          </div>

          <div className="frm-row">
            <label className="frm-lab" htmlFor={descriptionId}>
              {t("settings.description")}
              <span>{t("settings.serverDescriptionDetail")}</span>
            </label>
            <div className="frm-ctl">
              <textarea
                id={descriptionId}
                className="set-area"
                placeholder={t("settings.serverDescriptionPlaceholder")}
                value={draft.description}
                maxLength={280}
                disabled={!supported}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="frm-actions">
          {saveAction.failed ? (
            <p className="set-note sound-error" role="alert">
              {t("settings.serverSaveFailed")}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={!supported || !dirty || saveAction.pending}
            onClick={() => void save()}
          >
            {saved ? (
              <span className="sv-tick" aria-hidden="true">
                <Icon name="tick" size={15} />
              </span>
            ) : null}
            {saveAction.pending
              ? t("common.saving")
              : saved
                ? t("common.saved")
                : t("common.saveChanges")}
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}
