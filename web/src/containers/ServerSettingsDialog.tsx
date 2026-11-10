"use client";

import { useMemo, useSyncExternalStore } from "react";

import { ServerSettings } from "@/components/settings/ServerSettings";
import { applyAudioOutput } from "@/lib/voice/playback";
import {
  useDirectory,
  useEmoji,
  useLanguage,
  usePorts,
  useUi,
  useVoice,
} from "@/state/hooks";

import type { ServerAdmin } from "./useServerAdmin";

interface ServerSettingsDialogProps extends ServerAdmin {
  open: boolean;
}

/** Waits for a mutation, then reloads the admin lists behind it. */
async function reloadAfter(mutation: Promise<unknown>, reload: () => void) {
  await mutation;
  reload();
}

/** Waits for a mutation, then for the emoji set it changed. */
async function refreshAfter(mutation: Promise<unknown>, refresh: () => Promise<void>) {
  await mutation;
  await refresh();
}

/** The server settings dialog, wired to the admin port. */
export function ServerSettingsDialog({ open, data, reload }: ServerSettingsDialogProps) {
  const { admin, directory: directoryPort, soundboard, voiceSettings } = usePorts();
  const directory = useDirectory();
  const ui = useUi();
  const voice = useVoice();
  const { t } = useLanguage();
  const { emoji, refresh: refreshEmoji } = useEmoji();
  // The listener's own playback preferences, for the soundboard preview: the
  // speaker calls are routed to, and the two levels a clip is mixed through.
  const playback = useSyncExternalStore(
    voiceSettings.subscribe,
    voiceSettings.getSnapshot,
    voiceSettings.getSnapshot,
  );

  const channels = useMemo(
    () =>
      directory.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        ...(channel.sectionId === undefined ? {} : { sectionId: channel.sectionId }),
      })),
    [directory.channels],
  );

  const moveSection = async (sectionId: string, offset: -1 | 1) => {
    const ids = directory.sections.map((section) => section.id);
    const from = ids.indexOf(sectionId);
    const to = from + offset;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    await directoryPort.reorderSections(ids);
  };

  const { server } = directory;
  const { supported } = admin;

  return (
    <ServerSettings
      open={open}
      onClose={ui.closeModal}
      name={server.name}
      overview={{
        supported: supported.server,
        iconSupported: supported.serverIcon,
        name: server.name,
        mark: directory.serverMark,
        ...(server.iconUrl === undefined ? {} : { iconUrl: server.iconUrl }),
        createdAt: server.createdAt,
        memberCount: directory.members.length,
        channelCount: directory.channels.length,
        description: server.description ?? "",
        isPublic: server.isPublic ?? false,
        onSave: (patch) => admin.updateServer(patch),
        onPickIcon: async (file) => {
          await admin.uploadServerIcon(file);
        },
        onRemoveIcon: () => admin.removeServerIcon(),
      }}
      channels={{
        supported: supported.channels,
        channels,
        onAdd: () => ui.openCreateChannel("text"),
        onEdit: ui.openChannelSettings,
        sectionsSupported: supported.sections,
        sections: directory.sections,
        onAddSection: ui.openCreateSection,
        onEditSection: ui.openSectionSettings,
        onMoveSectionUp: (sectionId) => moveSection(sectionId, -1),
        onMoveSectionDown: (sectionId) => moveSection(sectionId, 1),
      }}
      roles={{
        supported: supported.roles,
        roles: data.roles,
        onCreate: (input) => reloadAfter(admin.createRole(input), reload),
        onUpdate: (roleId, patch) => reloadAfter(admin.updateRole(roleId, patch), reload),
        onDelete: (roleId) => reloadAfter(admin.deleteRole(roleId), reload),
      }}
      members={{
        supported: supported.members,
        members: data.members,
        roles: data.roles,
        onAssignRole: (userId, roleId) =>
          reloadAfter(admin.assignRole(userId, roleId), reload),
      }}
      invites={{
        supported: supported.invites,
        invites: data.invites,
        onCreate: () => reloadAfter(admin.createInvite(), reload),
        onRevoke: (inviteId) => reloadAfter(admin.revokeInvite(inviteId), reload),
      }}
      emoji={{
        supported: supported.emoji,
        emoji,
        onUpload: (shortcode, file) =>
          refreshAfter(admin.uploadEmoji(shortcode, file), refreshEmoji),
        onDelete: (emojiId) => refreshAfter(admin.deleteEmoji(emojiId), refreshEmoji),
      }}
      soundboard={{
        supported:
          voice.soundboard.supported && voice.soundboard.canManage && supported.soundboard,
        sounds: voice.sounds,
        everyoneCanPlay: voice.soundboard.settings.everyoneCanPlay,
        onEveryoneCanPlayChange: (everyoneCanPlay) => {
          void soundboard.updateSettings({ everyoneCanPlay }).catch(() => {});
        },
        rateLimited: voice.soundboard.settings.rateLimited,
        onRateLimitedChange: (rateLimited) => {
          void soundboard.updateSettings({ rateLimited }).catch(() => {});
        },
        loading: voice.soundboard.loading,
        error: voice.soundboard.error === null ? null : t(voice.soundboard.error),
        onCreate: (input) => soundboard.create(input),
        onUpdate: (soundId, patch) => soundboard.update(soundId, patch),
        onDelete: (soundId) => soundboard.delete(soundId),
        // The preview plays through the same speaker and the same two levels a
        // triggered clip does, so auditioning one is what hearing it will be.
        playback: {
          outputVolume: playback.outputVolume,
          soundboardVolume: playback.soundboardVolume,
          route: (element) => applyAudioOutput(element, playback),
        },
        onSoundboardVolumeChange: (soundboardVolume) => {
          voiceSettings.update({ soundboardVolume });
        },
      }}
      audit={{ supported: supported.audit, entries: data.audit }}
      bans={{
        supported: supported.bans,
        bans: data.bans,
        onUnban: (userId) => reloadAfter(admin.unban(userId), reload),
      }}
      danger={{
        supported: supported.server,
        serverName: server.name,
        onTransfer: async () => {
          const answer = window.prompt(t("settings.transferServerDetail"));
          if (answer === null) return;
          const needle = answer.trim().toLocaleLowerCase();
          const target = data.members.find(
            (member) =>
              member.user.id === answer ||
              member.user.username.toLocaleLowerCase() === needle ||
              member.user.displayName.toLocaleLowerCase() === needle,
          );
          if (target === undefined) return;
          await reloadAfter(admin.transferOwnership(target.user.id), reload);
        },
        onDelete: async () => {
          const answer = window.prompt(t("settings.deleteServerDetail"));
          if (answer !== server.name) return;
          await admin.deleteServer();
          window.location.reload();
        },
      }}
    />
  );
}
