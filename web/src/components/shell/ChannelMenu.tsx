"use client";

import { deleteChannel } from "@/components/confirmations";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import {
  ContextMenu,
  type MenuEntry,
  type MenuItem,
} from "@/components/primitives/ContextMenu";
import { useLanguage } from "@/state/hooks";

/**
 * What a rail row can be asked to do, beyond opening.
 *
 * Every one is optional and an absent one drops its item rather than showing a
 * dead one: what a channel offers depends on who is reading it, and the menu
 * that appears under the pointer should be the list of things that will happen.
 */
export interface ChannelMenuActions {
  /** Clears the badge without opening the channel. Text channels only. */
  onMarkRead?: (channelId: string) => void;
  /** User-local notification state. Voice channels never offer this action. */
  isMuted?: (channelId: string) => boolean;
  onSetMuted?: (channelId: string, muted: boolean) => void;
  /** Opens the invite dialog. The invite is to the server, as it is elsewhere. */
  onInvite?: () => void;
  /** The same dialog the cog on the row opens. */
  onOpenSettings?: (channelId: string) => void;
  /** Members may open notification settings for text channels; managers may open every channel. */
  canOpenSettings?: (
    channelId: string,
    kind: "text" | "voice",
  ) => boolean;
  /** Managers only, and asked about first. */
  onDelete?: (channelId: string) => void;
  /** Adds "Kopiuj identyfikator", as the preference in "Zaawansowane" promises. */
  developerMode?: boolean;
  /** Every section this server has, offered as "Przenieś do…" targets. */
  sections?: readonly { id: string; name: string }[];
  /** Managers only; needs both a section to offer and somewhere to send it. */
  onMoveToSection?: (channelId: string, sectionId: string | null) => void;
}

export interface ChannelMenuProps extends ChannelMenuActions {
  at: { x: number; y: number };
  channelId: string;
  kind: "text" | "voice";
  name: string;
  /** Decides whether marking it read is worth offering. */
  unread?: number;
  /** The section this channel already sits under, if any. */
  currentSectionId?: string;
  onClose: () => void;
}

/**
 * The right-click menu for a channel in the rail.
 *
 * Short, like the one on a person: opening a channel is a click, so the menu is
 * for the handful of things that are otherwise a trip through settings —
 * clearing a badge you are not going to read, inviting someone into the room
 * you are looking at, and, for whoever may edit it, the channel's own dialog.
 *
 * Deleting is here because it is the one destructive act that is genuinely
 * quicker from the rail than from inside the dialog, and it asks first.
 */
export function ChannelMenu({
  at,
  channelId,
  kind,
  name,
  unread = 0,
  currentSectionId,
  onMarkRead,
  isMuted,
  onSetMuted,
  onInvite,
  onOpenSettings,
  canOpenSettings,
  onDelete,
  developerMode = false,
  sections = [],
  onMoveToSection,
  onClose,
}: ChannelMenuProps) {
  const confirm = useConfirm();
  const { t } = useLanguage();
  const isText = kind === "text";

  const everyday: MenuItem[] = [];
  // Nothing to clear on a read channel, and voice channels have no badge at
  // all: an item that would do nothing is worse than a shorter menu.
  if (isText && unread > 0 && onMarkRead !== undefined) {
    everyday.push({
      id: "read",
      label: t("message.markRead"),
      icon: "tick",
      onSelect: () => onMarkRead(channelId),
    });
  }
  if (isText && isMuted !== undefined && onSetMuted !== undefined) {
    const muted = isMuted(channelId);
    everyday.push({
      id: muted ? "unmute-notifications" : "mute-notifications",
      label: t(
        muted ? "channel.unmuteNotifications" : "channel.muteNotifications",
      ),
      icon: muted ? "bell" : "bellSlash",
      onSelect: () => onSetMuted(channelId, !muted),
    });
  }
  if (onInvite !== undefined) {
    everyday.push({
      id: "invite",
      label: t("common.inviteFriends"),
      icon: "userAdd",
      onSelect: onInvite,
    });
  }

  const moves: MenuItem[] = [];
  if (onMoveToSection !== undefined && sections.length > 0) {
    for (const section of sections) {
      if (section.id === currentSectionId) continue;
      moves.push({
        id: `move-${section.id}`,
        label: t("section.moveToNamed", { name: section.name }),
        icon: "folder",
        onSelect: () => onMoveToSection(channelId, section.id),
      });
    }
    if (currentSectionId !== undefined) {
      moves.push({
        id: "move-none",
        label: t("section.removeFromSection"),
        icon: "x",
        onSelect: () => onMoveToSection(channelId, null),
      });
    }
  }

  const manage: MenuItem[] = [];
  if (
    onOpenSettings !== undefined &&
    (canOpenSettings?.(channelId, kind) ?? true)
  ) {
    manage.push({
      id: "settings",
      label: t("voiceBar.channelSettings"),
      icon: "gear",
      onSelect: () => onOpenSettings(channelId),
    });
  }
  if (onDelete !== undefined) {
    manage.push({
      id: "delete",
      label: t("channel.delete"),
      icon: "trash",
      danger: true,
      // A channel takes its messages with it, so this is the one item here
      // that stops and asks — the same dialog the rest of the app asks with.
      onSelect: () => {
        void confirm(deleteChannel(t, name)).then((confirmed) => {
          if (confirmed) onDelete(channelId);
        });
      },
    });
  }

  const advanced: MenuItem[] = developerMode
    ? [
        {
          id: "copy-id",
          label: t("common.copyId"),
          icon: "clipboard",
          onSelect: () => void navigator.clipboard?.writeText(channelId),
        },
      ]
    : [];

  const entries = [everyday, moves, manage, advanced]
    .filter((group) => group.length > 0)
    .flatMap((group, index): MenuEntry[] =>
      index === 0 ? group : ["separator", ...group],
    );
  if (entries.length === 0) return null;

  return (
    <ContextMenu
      at={at}
      entries={entries}
      label={`${isText ? t("channel.channel") : t("channel.voice")} ${name}`}
      onClose={onClose}
    />
  );
}
