"use client";

import { useDraggable } from "@dnd-kit/core";
import type { MouseEventHandler } from "react";

import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import type { VoiceDragData } from "@/components/shell/voiceMove";
import type { PersonVM } from "@/components/view-models";
import { useLanguage } from "@/state/hooks";

export interface VoiceOccupantRowProps {
  person: PersonVM;
  sourceChannelId: string;
  self: boolean;
  /** Whether staff may move people at all; you and a person in flight never are. */
  draggable: boolean;
  /** The server has not confirmed this person's move yet. */
  moving: boolean;
  onContextMenu?: MouseEventHandler<HTMLLIElement>;
}

/**
 * Someone seated under a voice channel.
 *
 * Mute and speech are printed as well as drawn, since this list is where you
 * learn who is on the call. When the row can be moved, the whole row is the
 * drag handle and the keyboard sensor makes it a button.
 */
export function VoiceOccupantRow({
  person,
  sourceChannelId,
  self,
  draggable,
  moving,
  onContextMenu,
}: VoiceOccupantRowProps) {
  const { t } = useLanguage();
  const enabled = draggable && !self && !moving;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `voice-member:${sourceChannelId}:${person.id}`,
    disabled: !enabled,
    data: {
      type: "voice-occupant",
      person,
      sourceChannelId,
    } satisfies VoiceDragData,
  });
  const className = [
    "voice-occupant",
    self && "me",
    person.speaking && "speaking",
    person.muted === true && "muted",
    enabled && "is-draggable",
    isDragging && "is-dragging",
    moving && "is-moving",
  ]
    .filter(Boolean)
    .join(" ");

  const state = moving
    ? t("shell.moving")
    : person.muted === true
      ? t("shell.muted")
      : person.speaking
        ? t("roster.speaking")
        : t("roster.silent");

  return (
    <li
      ref={setNodeRef}
      className={className}
      onContextMenu={onContextMenu}
      title={enabled ? t("shell.dragVoiceMember") : undefined}
      {...(enabled ? { ...attributes, ...listeners } : {})}
      aria-label={
        enabled
          ? t("shell.moveVoiceMember", { name: person.displayName })
          : undefined
      }
      aria-roledescription={enabled ? t("shell.dragHandle") : undefined}
      aria-busy={moving || undefined}
    >
      <Avatar
        id={person.id}
        displayName={person.displayName}
        initials={person.initials}
        avatarUrl={person.avatarUrl}
        size="xs"
        speaking={person.speaking}
      />
      <span className="occ-name">{person.displayName}</span>
      {person.muted === true ? (
        <span className="occ-mic" aria-hidden="true">
          <Icon name="micSlash" size={13} />
        </span>
      ) : null}
      <span className="sr-only">{state}</span>
    </li>
  );
}
