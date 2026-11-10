"use client";

import { Avatar, type Presence } from "@/components/primitives/Avatar";
import type { PersonVM } from "@/components/view-models";

export interface FriendIdentityProps {
  person: PersonVM;
  /** Without the "@"; printed after the display name. */
  username: string;
  /** The line under the name. */
  state: string;
  /**
   * Shows the status dot. Left out for someone you have blocked, whose face is
   * drained instead: their presence is not yours to see.
   */
  presence?: Presence;
  onOpenProfile: (anchor: HTMLElement) => void;
}

/**
 * The part of a Friends row that opens the person's card: face, name, handle
 * and a line of state. The row's actions sit beside it as their own controls.
 */
export function FriendIdentity({
  person,
  username,
  state,
  presence,
  onOpenProfile,
}: FriendIdentityProps) {
  return (
    <button
      type="button"
      className="fr-open"
      aria-haspopup="dialog"
      onClick={(event) => onOpenProfile(event.currentTarget)}
    >
      <Avatar
        id={person.id}
        displayName={person.displayName}
        initials={person.initials}
        avatarUrl={person.avatarUrl}
        size="md"
        presence={presence}
        offline={presence === undefined ? true : undefined}
      />
      <span className="fr-who">
        <b>
          <span className="fr-display-name">{person.displayName}</span>
          <span className="fr-tag">@{username}</span>
        </b>
        <span className="fr-state">{state}</span>
      </span>
    </button>
  );
}
