"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@stellarr/ui";
import { Icon } from "@stellarr/ui/icons";
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
/** The server's limit; checking here keeps the field from promising more. */
const PRONOUNS_MAX = 32;

export interface AccountPaneProps {
  account: Account;
  /** The arrival sound, saved on its own the moment it changes. */
  joinSound?: JoinSoundPicker;
  customEmoji?: readonly CustomEmoji[];
  onSave: (patch: AccountPatch) => Promise<void> | void;
  onPickImage: (kind: ImageKind, file: File) => Promise<void> | void;
  /** Back to the built-in art chosen by id. */
  onRemoveImage: (kind: ImageKind) => Promise<void> | void;
}

/**
 * The profile pane.
 *
 * Public identity stays together: name, pronouns and bio share one preview and
 * one save action. Pictures and the arrival sound take effect the moment they
 * are chosen, because there is nothing to type and nothing to half-finish. Login credentials are a different task and live in the
 * security pane, so a profile save cannot carry a half-edited recovery address
 * or password with it.
 */
export function AccountPane({
  account,
  joinSound,
  customEmoji = [],
  onSave,
  onPickImage,
  onRemoveImage,
}: AccountPaneProps) {
  const { t } = useLanguage();
  const nameId = useId();
  const pronounsId = useId();
  const savedTimer = useRef<number | undefined>(undefined);

  const [displayName, setDisplayName] = useState(account.displayName);
  const [pronouns, setPronouns] = useState(account.pronouns);
  const [bio, setBio] = useState(account.bio);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The saved account changed underneath, which is also what a rejected save
  // looks like from here. Derived during render so the fields repaint in one
  // pass.
  const [synced, setSynced] = useState({
    displayName: account.displayName,
    pronouns: account.pronouns,
    bio: account.bio,
  });
  if (
    synced.displayName !== account.displayName ||
    synced.pronouns !== account.pronouns ||
    synced.bio !== account.bio
  ) {
    setSynced({ displayName: account.displayName, pronouns: account.pronouns, bio: account.bio });
    setDisplayName(account.displayName);
    setPronouns(account.pronouns);
    setBio(account.bio);
  }

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const dirty =
    displayName.trim() !== account.displayName.trim() ||
    pronouns.trim() !== account.pronouns.trim() ||
    bio.trim() !== account.bio.trim();

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        displayName: displayName.trim(),
        pronouns: pronouns.trim(),
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

  const removeImage = (kind: ImageKind) => {
    setSaveError(null);
    void Promise.resolve(onRemoveImage(kind)).catch(() => {
      setSaveError(t("account.imageRemoveFailed"));
    });
  };

  const hasAvatar = typeof account.avatarUrl === "string";
  const hasBanner = typeof account.bannerUrl === "string";

  return (
    <>
      <ProfileCardPreview
        account={account}
        bio={bio}
        pronouns={pronouns}
        customEmoji={customEmoji}
        onPickImage={pickImage}
      />

      {/* Only an uploaded picture can be removed; the built-in art is what
          removing one goes back to. */}
      {hasAvatar || hasBanner ? (
        <div className="pf-remove">
          {hasAvatar ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => removeImage("avatar")}>
              {t("account.removeAvatar")}
            </Button>
          ) : null}
          {hasBanner ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => removeImage("banner")}>
              {t("account.removeBackground")}
            </Button>
          ) : null}
        </div>
      ) : null}

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

        <div className="frm-row">
          <label className="frm-lab" htmlFor={pronounsId}>
            {t("account.pronouns")}
            <span>{t("account.pronounsDetail")}</span>
          </label>
          <div className="frm-ctl">
            <input
              id={pronounsId}
              className="set-input"
              type="text"
              value={pronouns}
              maxLength={PRONOUNS_MAX}
              placeholder={t("account.pronounsPlaceholder")}
              onChange={(event) => setPronouns(event.target.value)}
            />
          </div>
        </div>

        <BioEditor value={bio} customEmoji={customEmoji} onChange={setBio} />
      </div>

      <div className="frm-actions">
        <Button
          type="button"
          variant="primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saved ? (
            <span className="sv-tick" aria-hidden="true">
              <Icon name="tick" size={15} />
            </span>
          ) : null}
          {saved ? t("common.saved") : t("common.saveChanges")}
        </Button>
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
