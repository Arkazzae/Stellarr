import type { IconName } from "@stellarr/ui/icons";
import type { SettingsShellGroup, SettingsShellItem } from "@/components/settings/SettingsShell";
import type { Translator } from "@/i18n";
import type { ChannelKind, OpusProfileId } from "@/ports";

/** The editable fields of one channel, as the dialog's form sees them. */
export interface ChannelSettingsVM {
  id: string;
  kind: ChannelKind;
  name: string;
  topic: string;
  slowModeSeconds: number;
  hideAfterInactivityHours: number;
  /** Voice only; the codec profile shared by the call. */
  audioProfile: OpusProfileId;
  userLimit: number;
  /** The section the channel sits in, shown beside its name; none when unsectioned. */
  sectionName?: string;
}

export type ChannelSettingsPaneKey = "overview" | "notifications" | "permissions" | "danger";

export interface ChannelSettingsNavItem extends SettingsShellItem<ChannelSettingsPaneKey> {
  /** The sentence under the pane's name in the bar. */
  detail: string;
}

export interface ChannelSettingsNavGroup extends SettingsShellGroup<ChannelSettingsPaneKey> {
  items: readonly ChannelSettingsNavItem[];
}

/** The mark of a channel kind, used wherever a channel is drawn. */
export const channelIcon = (kind: ChannelKind): IconName => (kind === "voice" ? "speaker" : "hash");

/** A text channel is written with its hash, a voice channel without one. */
export const channelLabel = (kind: ChannelKind, name: string): string =>
  `${kind === "voice" ? "" : "#"}${name}`;

/**
 * The groups and words of the server settings: a general group with the
 * channel's own panes, then management with access and deletion.
 *
 * A member who cannot manage the channel only gets notifications, and only on
 * a text channel; the dialog does not open for them on a voice channel.
 */
export function navigationFor(
  kind: ChannelKind,
  canManageChannel: boolean,
  t: Translator,
): readonly ChannelSettingsNavGroup[] {
  const voice = kind === "voice";
  const notifications: ChannelSettingsNavItem = {
    key: "notifications",
    label: t("channel.notifications"),
    icon: "bell",
    detail: t("channel.notificationsDetail"),
  };

  if (!canManageChannel && !voice) {
    return [{ caption: t("server.general"), items: [notifications] }];
  }

  const overview: ChannelSettingsNavItem = {
    key: "overview",
    label: t("server.overview"),
    icon: channelIcon(kind),
    detail: voice ? t("channel.nameLimitVisibility") : t("channel.nameTopicVisibility"),
  };

  return [
    {
      caption: t("server.general"),
      items: voice ? [overview] : [overview, notifications],
    },
    {
      caption: t("server.management"),
      items: [
        {
          key: "permissions",
          label: t("channel.permissions"),
          icon: "shield",
          detail: t("channel.permissionsDetail"),
        },
        {
          key: "danger",
          label: t("server.danger"),
          icon: "trash",
          detail: t("channel.deleteDetail"),
          danger: true,
        },
      ],
    },
  ];
}

export function initialPane(
  channel: ChannelSettingsVM | null,
  canManageChannel: boolean,
): ChannelSettingsPaneKey {
  return channel?.kind === "text" && !canManageChannel ? "notifications" : "overview";
}
