"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import type {
  Account,
  AccountPatch,
  CustomEmoji,
  ImageKind,
  JoinSoundPicker,
} from "@/ports";
import { useLanguage } from "@/state/hooks";

import { BioEditor } from "./BioEditor";
import { JoinSoundSection } from "./JoinSoundSection";
import { ProfileCardPreview } from "./ProfileCardPreview";

/** How long the save button keeps showing its tick. */
const SAVED_FLASH_MS = 1500;

export interface AccountPaneProps {
  account: Account;
  /** The arrival sound, saved on its own the moment it changes. */
  joinSound?: JoinSoundPicker;
  /** False only when connected to an older backend without profile writes. */
  profileSupported: boolean;
  uploadsSupported: boolean;
  customEmoji?: readonly CustomEmoji[];
  onSave: (patch: AccountPatch) => Promise<void> | void;
  onPickImage: (kind: ImageKind, file: File) => Promise<void> | void;
  /** Part of the container wiring; no control in this pane clears a picture. */
  onRemoveImage: (kind: ImageKind) => Promise<void> | void;
}

/**
 * The profile pane.
 *
 * Public identity stays together: name, pictures and bio share one preview and
 * one save action. Login credentials are a different task and live in the
 * security pane, so a profile save cannot carry a half-edited recovery address
 * or password with it.
 */
export function AccountPane({
  account,
  joinSound,
  profileSupported,
  uploadsSupported,
  customEmoji = [],
  onSave,
  onPickImage,
}: AccountPaneProps) {
  const { t } = useLanguage();
  const nameId = useId();
  const savedTimer = useRef<number | undefined>(undefined);

  const [displayName, setDisplayName] = useState(account.displayName);
  const [bio, setBio] = useState(account.bio);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The saved account changed underneath, which is also what a rejected save
  // looks like from here. Derived during render so the fields repaint in one
  // pass.
  const [synced, setSynced] = useState({
    displayName: account.displayName,
    bio: account.bio,
  });
  if (synced.displayName !== account.displayName || synced.bio !== account.bio) {
    setSynced({ displayName: account.displayName, bio: account.bio });
    setDisplayName(account.displayName);
    setBio(account.bio);
  }

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const dirty =
    displayName.trim() !== account.displayName.trim() ||
    bio.trim() !== account.bio.trim();

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        displayName: displayName.trim(),
        // Not editable here, but a save replaces the profile as a whole.
        pronouns: account.pronouns,
        bio: bio.trim(),
      });
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS);
    } catch {
      setSaveError(t("account.profileSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const pickImage = (kind: ImageKind, file: File) => {
    setSaveError(null);
    void Promise.resolve(onPickImage(kind, file)).catch(() => {
      setSaveError(t("account.imageUploadFailed"));
    });
  };

  return (
    <>
      {profileSupported && uploadsSupported ? null : (
        <p className="set-note">{t("settings.serverUnsupported")}</p>
      )}

      <ProfileCardPreview
        account={account}
        bio={bio}
        customEmoji={customEmoji}
        uploadsSupported={uploadsSupported}
        onPickImage={pickImage}
      />

      <div className="frm">
        <div className="frm-row">
          <label className="frm-lab" htmlFor={nameId}>
            {t("account.displayName")}
            <span>{t("account.displayNameDetail")}</span>
          </label>
          <div className="frm-ctl">
            <input
              id={nameId}
              className="set-input"
              type="text"
              value={displayName}
              maxLength={64}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
        </div>

        <BioEditor value={bio} customEmoji={customEmoji} onChange={setBio} />
      </div>

      <div className="frm-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saved ? (
            <span className="sv-tick" aria-hidden="true">
              <Icon name="tick" size={15} />
            </span>
          ) : null}
          {saved ? t("common.saved") : t("common.saveChanges")}
        </button>
      </div>
      {saveError === null ? null : (
        <p className="acc-answer bad" role="alert">
          {saveError}
        </p>
      )}

      {joinSound ? <JoinSoundSection joinSound={joinSound} /> : null}
    </>
  );
}
