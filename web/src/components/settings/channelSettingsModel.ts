import type { IconName } from "@stellarr/ui/icons";
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
}

export type ChannelSettingsPaneKey =
  | "general"
  | "voice"
  | "notifications"
  | "permissions"
  | "danger";

export interface ChannelSettingsNavItem {
  key: ChannelSettingsPaneKey;
  label: string;
  icon: IconName;
  detail: string;
  danger?: boolean;
}

export interface ChannelSettingsNavGroup {
  caption: string;
  items: readonly ChannelSettingsNavItem[];
}

/**
 * A member who cannot manage the channel only gets notifications, and only on
 * a text channel: a voice channel always shows its voice pane and the rest.
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
    return [{ caption: t("channel.channel"), items: [notifications] }];
  }

  const general: ChannelSettingsNavItem = {
    key: "general",
    label: t("settings.general"),
    icon: voice ? "speaker" : "hash",
    detail: voice ? t("channel.nameVisibility") : t("channel.nameTopicVisibility"),
  };
  const voicePane: ChannelSettingsNavItem = {
    key: "voice",
    label: t("settings.voiceVideo"),
    icon: "headphones",
    detail: t("channel.personLimitDetail"),
  };

  return [
    {
      caption: t("channel.channel"),
      items: [general, voice ? voicePane : notifications],
    },
    {
      caption: t("settings.access"),
      items: [
        {
          key: "permissions",
          label: t("channel.permissions"),
          icon: "shield",
          detail: t("channel.permissionsDetail"),
        },
      ],
    },
    {
      caption: t("settings.other"),
      items: [
        {
          key: "danger",
          label: t("channel.delete"),
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
  return channel?.kind === "text" && !canManageChannel ? "notifications" : "general";
}
