import type { CSSProperties } from "react";

import type { PersonVM } from "@/components/view-models";
import { defaultIdentityArt, identityVars } from "@/design/identity";
import { initials as toInitials } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

/** Taken from the view model so components never import `@/lib/api`. */
export type Presence = PersonVM["presence"];

/**
 * The avatar scale, with nothing between the steps: 24, 32, 40 and 64px, the
 * `--av-*` tokens in `recipe.css`. A context that wants another face picks
 * another size; it does not write a width.
 */
export type AvatarSize = "xs" | "sm" | "md" | "xl";

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "av-xs",
  sm: "av-sm",
  md: "av-md",
  xl: "av-xl",
};

export interface AvatarProps {
  id: string;
  displayName: string;
  /** Precomputed by the view model; derived from the name only as a fallback. */
  initials?: string;
  /**
   * An uploaded picture. Without one, the person's id picks a built-in
   * identity graphic. The initials stay underneath either way, so a slow or
   * broken image still leaves something to read.
   */
  avatarUrl?: string;
  size?: AvatarSize;
  /**
   * Renders the status dot. Left off for people in a call, where speech state
   * is shown instead and two dots would contradict each other.
   */
  presence?: Presence;
  /** The accent ring, passed by whoever knows the speech state. */
  speaking?: boolean;
  /** Drains the hue. Defaults to `presence === "offline"`. */
  offline?: boolean;
  /** Dims the whole face, for columns that have no row to dim around it. */
  dim?: boolean;
  /**
   * A server notice rather than a person: the neutral fallback, with no hue
   * derived from an id that names a system. A supplied server icon is still
   * rendered.
   */
  system?: boolean;
  /**
   * Makes the face the control that raises a profile; the handler receives the
   * element the card should hang off. Without it the face is decoration and
   * hidden from assistive tech, because the name is always beside it.
   */
  onOpen?: (anchor: HTMLElement) => void;
  /** The button's accessible name. Defaults to "Profil: <name>". */
  label?: string;
  className?: string;
  title?: string;
}

/**
 * One face for the whole app.
 *
 * The colour derives from the id, so a person looks the same in every list.
 * Geometry, the speaking ring and the status dot live in `avatar.css`.
 */
export function Avatar({
  id,
  displayName,
  initials,
  avatarUrl,
  size = "sm",
  presence,
  speaking,
  offline,
  dim,
  system = false,
  onOpen,
  label,
  className,
  title,
}: AvatarProps) {
  const { t } = useLanguage();
  const hasUpload = avatarUrl !== undefined && avatarUrl !== "";
  const pictureUrl = hasUpload
    ? avatarUrl
    : system
      ? undefined
      : defaultIdentityArt(id).avatarUrl;
  const style: CSSProperties = system
    ? ({ "--person-bg": "var(--info-line)" } as CSSProperties)
    : identityVars(id, offline ?? presence === "offline");

  const classes = [
    "av",
    SIZE_CLASS[size],
    speaking ? "speaking" : null,
    dim ? "dim" : null,
    onOpen ? "av-btn" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  /* The picture is laid over the initials instead of replacing them: one that
     fails to load reveals the initials rather than a blank disc. `alt=""`
     because the name is always beside the face. */
  const face = (
    <>
      {initials ?? toInitials(displayName)}
      {pictureUrl === undefined ? null : (
        // Not `next/image`: uploads come from an unknown self-hosted origin,
        // which `DESIGN.md` §10 keeps off the optimiser. Not draggable either:
        // a native image drag, started by grabbing a person to move them
        // between calls, kills the pointer stream and can drop the picture
        // into the transcript as an attachment.
        <img
          className="av-img"
          src={pictureUrl}
          alt=""
          loading="lazy"
          draggable={false}
        />
      )}
      {presence === undefined ? null : <PresenceDot presence={presence} />}
    </>
  );

  if (onOpen !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        style={style}
        title={title}
        aria-haspopup="dialog"
        aria-label={label ?? t("profile.label", { name: displayName })}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        {face}
      </button>
    );
  }

  return (
    <span className={classes} style={style} title={title} aria-hidden="true">
      {face}
    </span>
  );
}

export interface PresenceDotProps {
  presence: Presence;
  className?: string;
}

/**
 * The avatar's status dot on its own, for the DM room header, which shows it
 * beside a name instead of on a face.
 */
export function PresenceDot({ presence, className }: PresenceDotProps) {
  const classes = ["pdot", presence, className].filter(Boolean).join(" ");
  return <span className={classes} aria-hidden="true" />;
}
