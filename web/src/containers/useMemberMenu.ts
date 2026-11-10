"use client";

import type { UserMenuActions } from "@/components/roster/UserMenu";
import {
  useAccount,
  useDirectory,
  useFriends,
  usePorts,
  useProfile,
  useVoice,
} from "@/state/hooks";

/**
 * What a right-click on a person does wherever people are listed.
 *
 * The profile card, a message, the listener's own strip in the current call and
 * moderation are the same everywhere; the roster adds the friendship items on
 * top. Moderation needs both halves: the member must hold the permission, and
 * the adapter must have a persisted endpoint behind it.
 */
export function useMemberMenu(): UserMenuActions {
  const { voiceChannels, canModerateMembers, canManageBans } = useDirectory();
  const { admin } = usePorts();
  const voice = useVoice();
  const profile = useProfile();
  const friends = useFriends();
  const { preferences } = useAccount();

  const seatOf = (userId: string) =>
    voiceChannels.find((channel) =>
      channel.occupants.some((person) => person.id === userId),
    );

  return {
    onOpenProfile: profile.toggle,
    onMessage: (userId) => friends.messagePerson(userId),
    participantVolumeOf: (userId) => voice.participantVolumes.get(userId),
    onParticipantVolumeChange: voice.setParticipantVolume,
    participantGateOf: (userId) => voice.participantGates.get(userId),
    onParticipantGateChange: voice.setParticipantGate,
    participantSuppressionOf: (userId) =>
      voice.participantSuppressions.get(userId),
    onParticipantSuppressionChange: voice.setParticipantSuppression,
    canKick: canModerateMembers && admin.supported.moderation,
    canBan: canManageBans && admin.supported.moderation,
    ...(admin.kickFromChannel === undefined
      ? {}
      : {
          canKickFromChannel: (userId: string) => seatOf(userId) !== undefined,
          onKickFromChannel: (userId: string) => {
            const seat = seatOf(userId);
            if (seat !== undefined) void admin.kickFromChannel?.(seat.id, userId);
          },
        }),
    onKick: (userId) => void admin.kick(userId),
    onBan: (userId, reason) =>
      void admin.ban(userId, reason.length === 0 ? undefined : reason),
    developerMode: preferences.developerMode,
  };
}
