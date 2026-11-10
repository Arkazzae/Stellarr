"use client";

import { useMemo } from "react";

import { ChannelCreate } from "@/components/settings/ChannelCreate";
import { ChannelSettings, type ChannelSettingsVM } from "@/components/settings/ChannelSettings";
import { ApiError, describeError } from "@/lib/api/errors";
import type { OpusProfileId, Role } from "@/ports";
import { useAccount, useDirectory, useLanguage, usePorts, useUi } from "@/state/hooks";

import { usePermissionOverrides } from "./usePermissionOverrides";

/**
 * What a voice channel is worth until the server can say otherwise: the value
 * the voice pipeline defaults to, so the dialog opens on what the call is
 * actually running at rather than on a guess.
 */
const DEFAULT_CHANNEL_AUDIO: OpusProfileId = "premium";

/** The cog on a rail row: one channel's settings, permissions and deletion. */
export function ChannelSettingsDialog({ roles }: { roles: readonly Role[] }) {
  const { admin } = usePorts();
  const account = useAccount();
  const directory = useDirectory();
  const ui = useUi();

  const channelId = ui.channelSettingsId;
  const { overrides, save } = usePermissionOverrides(
    "channel",
    ui.modal === "channel" ? channelId : null,
  );

  // Screen-share quality is not here: it belongs to each sender, on every
  // channel, and is not a property of the channel.
  const channel = useMemo<ChannelSettingsVM | null>(() => {
    const found = directory.channels.find((item) => item.id === channelId);
    if (found === undefined) return null;
    return {
      id: found.id,
      kind: found.kind,
      name: found.name,
      topic: found.topic ?? "",
      slowModeSeconds: found.slowModeSeconds ?? 0,
      hideAfterInactivityHours: found.hideAfterInactivityHours ?? 0,
      audioProfile: found.audioProfile ?? DEFAULT_CHANNEL_AUDIO,
      userLimit: found.userLimit ?? 0,
    };
  }, [directory.channels, channelId]);

  const setMuted = (muted: boolean) => {
    if (channelId === null) return;
    const mutedChannelIds = account.preferences.mutedChannelIds.filter((id) => id !== channelId);
    if (muted) mutedChannelIds.push(channelId);
    void account.setPreferences({ mutedChannelIds });
  };

  return (
    <ChannelSettings
      open={
        ui.modal === "channel" && (directory.canManageChannels || channel?.kind === "text")
      }
      onClose={ui.closeModal}
      channel={channel}
      supported={admin.supported.channels}
      canManageChannel={directory.canManageChannels}
      roles={roles}
      permissionsSupported={admin.supported.roles}
      permissionOverrides={overrides}
      notificationMuted={
        channelId !== null && account.preferences.mutedChannelIds.includes(channelId)
      }
      notificationSupported={account.supported.preferences}
      onNotificationMutedChange={setMuted}
      onSave={async (patch) => {
        if (channelId !== null) await admin.updateChannel(channelId, patch);
      }}
      onSavePermissionOverride={save}
      onDelete={async () => {
        if (channelId === null) return;
        await admin.deleteChannel(channelId);
        ui.closeModal();
      }}
      onOpenRoles={() => ui.openModal("settings")}
    />
  );
}

/** The "+" beside a rail caption. */
export function ChannelCreateDialog() {
  const { admin } = usePorts();
  const directory = useDirectory();
  const ui = useUi();
  const { t } = useLanguage();

  return (
    <ChannelCreate
      open={ui.modal === "channel-new"}
      onClose={ui.closeModal}
      kind={ui.newChannelKind ?? "text"}
      supported={admin.supported.channels}
      sections={directory.sections}
      onCreate={async (input) => {
        try {
          await admin.createChannel(input);
        } catch (cause) {
          throw new Error(
            cause instanceof ApiError && cause.status === 409
              ? t("channel.createDuplicate")
              : describeError(cause, t("channel.createFailed"), t),
          );
        }
      }}
    />
  );
}
