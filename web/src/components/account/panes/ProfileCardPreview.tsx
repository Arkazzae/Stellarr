"use client";

import { useRef, type CSSProperties, type RefObject } from "react";

import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import { ProfileBioText } from "@/components/profile/ProfileBio";
import { defaultIdentityArt, hueFor } from "@/design/identity";
import type { Account, CustomEmoji, ImageKind } from "@/ports";
import { useLanguage } from "@/state/hooks";

interface ProfileCardPreviewProps {
  account: Account;
  /** The bio being edited, which the card shows before it is saved. */
  bio: string;
  customEmoji: readonly CustomEmoji[];
  onPickImage: (kind: ImageKind, file: File) => void;
}

/**
 * The card the pane produces, at the size it will be seen, and the control
 * that changes it. Both pictures are real buttons, so the gesture works from
 * the keyboard and each one says what it will do.
 */
export function ProfileCardPreview({
  account,
  bio,
  customEmoji,
  onPickImage,
}: ProfileCardPreviewProps) {
  const { t } = useLanguage();
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const openPicker = (input: HTMLInputElement | null) => {
    if (input === null) return;
    // Cleared before opening as well as after `change`: some browsers keep the
    // old selection when React swaps the image after an upload, which would
    // make choosing the same file again do nothing.
    input.value = "";
    input.click();
  };

  const hasAvatar = typeof account.avatarUrl === "string";
  const hasBanner = typeof account.bannerUrl === "string";

  return (
    <>
      <section className="pf-preview" aria-label={t("account.profileCard")}>
        <button
          type="button"
          className="pf-shot pf-banner"
          style={{ "--mp-hue": hueFor(account.id) } as CSSProperties}
          onClick={() => openPicker(bannerInput.current)}
        >
          <img
            src={account.bannerUrl || defaultIdentityArt(account.id).bannerUrl}
            alt=""
          />
          <span className="pf-veil">
            <Icon name="camera" size={18} />
            {hasBanner
              ? t("account.changeBackground")
              : t("account.addBackground")}
          </span>
        </button>

        <div className="pf-face">
          <button
            type="button"
            className="pf-shot pf-shot-av"
            onClick={() => openPicker(avatarInput.current)}
          >
            <Avatar
              id={account.id}
              displayName={account.displayName || "?"}
              {...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {})}
              size="xl"
            />
            <span className="pf-veil">
              <Icon name="camera" size={16} />
              <span className="sr-only">
                {hasAvatar ? t("account.changeAvatar") : t("account.addAvatar")}
              </span>
            </span>
          </button>

          {/* The name as it will read on the card, so the field below has a
              visible result and does not need to repeat it. */}
          <span className="pf-face-txt">
            <b>{account.displayName}</b>
            <span>@{account.username}</span>
          </span>
        </div>

        {bio.trim().length === 0 ? null : (
          <p className="pf-preview-bio">
            <ProfileBioText text={bio} customEmoji={customEmoji} />
          </p>
        )}
      </section>

      {/* A styled `<input type="file">` is the one control that cannot be made
          to match the rest without losing its keyboard behaviour, so each
          picture gets a hidden input behind its button. */}
      <PictureInput kind="avatar" inputRef={avatarInput} onPick={onPickImage} />
      <PictureInput kind="banner" inputRef={bannerInput} onPick={onPickImage} />
    </>
  );
}

function PictureInput({
  kind,
  inputRef,
  onPick,
}: {
  kind: ImageKind;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (kind: ImageKind, file: File) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      className="sr-only"
      tabIndex={-1}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        // Cleared synchronously, before an upload can re-render the pane.
        event.currentTarget.value = "";
        if (file !== undefined) onPick(kind, file);
      }}
    />
  );
}
