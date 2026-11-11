"use client";

import { useMemo } from "react";

import { FriendsActivity } from "@/components/friends/FriendsActivity";
import type { ActiveFriendVM } from "@/components/view-models";
import { initials } from "@/lib/format";
import { useDirectory, useFriends, useLanguage, useProfile, useSession } from "@/state/hooks";

export function FriendsActivityContainer() {
  const { friends, blocked, conversations, messagePerson } = useFriends();
  const { voiceChannels, server } = useDirectory();
  const { user } = useSession();
  const profile = useProfile();
  const { locale } = useLanguage();

  const activeFriends = useMemo<ActiveFriendVM[]>(() => {
    const blockedIds = new Set(blocked.map((person) => person.id));
    const calls = new Set(
      conversations.flatMap((conversation) =>
        (conversation.callParticipants ?? []).map((person) => person.userId),
      ),
    );
    const channels = new Map(
      voiceChannels.flatMap((channel) =>
        channel.occupants.map((person) => [person.id, channel.name] as const),
      ),
    );

    return friends
      // RTC occupancy must never reveal somebody who is offline or invisible.
      .filter(({ user: person }) =>
        person.presence !== "offline" && person.id !== user?.id && !blockedIds.has(person.id),
      )
      .map(({ user: person }) => {
        const channelName = channels.get(person.id);
        const customStatus = person.customStatus?.trim();
        return {
          person: {
            id: person.id,
            displayName: person.displayName,
            initials: initials(person.displayName),
            presence: person.presence,
            ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
          },
          ...(customStatus ? { customStatus } : {}),
          inCall: channelName !== undefined || calls.has(person.id),
          ...(channelName === undefined ? {} : {
            voiceChannel: { name: channelName, serverName: server.name },
          }),
        };
      })
      .sort((a, b) =>
        Number(b.inCall) - Number(a.inCall) ||
        a.person.displayName.localeCompare(b.person.displayName, locale),
      );
  }, [friends, blocked, conversations, voiceChannels, server.name, user?.id, locale]);

  return (
    <FriendsActivity
      friends={activeFriends}
      onOpenProfile={profile.toggle}
      onMessage={messagePerson}
    />
  );
}
