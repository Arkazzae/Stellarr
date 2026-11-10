"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { MiniProfile } from "@/components/profile/MiniProfile";
import type { PersonVM, ProfileVM } from "@/components/view-models";
import { formatDate, initials } from "@/lib/format";
import type { AdminMember, Role, User } from "@/ports";
import {
  useDirectory,
  useEmoji,
  useFriends,
  usePorts,
  useProfile,
  useSession,
  useUi,
} from "@/state/hooks";

import { relationTo } from "./relationTo";

interface Membership {
  members: AdminMember[];
  roles: Role[];
}

const NO_MEMBERSHIP: Membership = { members: [], roles: [] };

function toPerson(user: User): PersonVM {
  return {
    id: user.id,
    displayName: user.displayName,
    initials: initials(user.displayName),
    presence: user.presence,
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

/**
 * Roles and join dates, asked of the admin port when the first card opens.
 *
 * They are the one part of the card that comes from a port that may not be
 * wired. When it fails the rest of the card renders without them, and the next
 * card asks again.
 */
function useMembership(wanted: boolean): Membership {
  const { admin } = usePorts();
  const [membership, setMembership] = useState(NO_MEMBERSHIP);
  const asked = useRef(false);

  useEffect(() => {
    if (!wanted || asked.current) return;
    asked.current = true;
    void (async () => {
      try {
        const [members, roles] = await Promise.all([
          admin.listMembers(),
          admin.listRoles(),
        ]);
        setMembership({ members, roles });
      } catch {
        asked.current = false;
      }
    })();
  }, [wanted, admin]);

  return membership;
}

/**
 * The mini profile, assembled.
 *
 * Four sources answer "who is this" and none knows the whole person: the
 * directory has their face and presence, the friends graph what you are to
 * each other, the admin port what they are on this server, and the voice
 * channels where they are right now. The card is where those meet.
 */
export function MiniProfileContainer() {
  const directory = useDirectory();
  const { emoji: customEmoji } = useEmoji();
  const friends = useFriends();
  const { friends: friendList, requests, blocked } = friends;
  const { user } = useSession();
  const profile = useProfile();
  const ui = useUi();

  const userId = profile.open?.userId ?? null;
  const membership = useMembership(userId !== null);

  const vm = useMemo<ProfileVM | null>(() => {
    if (userId === null) return null;

    // The directory is the first answer and the best one: it alone carries
    // live presence. Someone reachable only through the friends graph, such as
    // a friend who is not on this server, is found there.
    const request = requests.find((entry) => entry.user.id === userId);
    const friend = friendList.find((entry) => entry.user.id === userId);
    const known: User | undefined =
      directory.members.find((member) => member.id === userId) ??
      friend?.user ??
      blocked.find((person) => person.id === userId) ??
      request?.user ??
      (user?.id === userId ? user : undefined);
    if (known === undefined) return null;

    const member = membership.members.find((entry) => entry.user.id === userId);
    const role = membership.roles.find((entry) => entry.id === member?.roleId);
    // The roster says where they are too, but the card is often opened from
    // somewhere the roster is not on screen.
    const call = directory.voiceChannels.find((channel) =>
      channel.occupants.some((occupant) => occupant.id === userId),
    );

    return {
      person: toPerson(known),
      username: known.username,
      relation: relationTo(userId, user?.id, { friends: friendList, requests, blocked }),
      roles:
        role === undefined
          ? []
          : [{ id: role.id, name: role.name, color: role.color }],
      ...(known.bannerUrl === undefined ? {} : { bannerUrl: known.bannerUrl }),
      ...(known.customStatus === undefined ? {} : { customStatus: known.customStatus }),
      ...(known.bio === undefined ? {} : { bio: known.bio }),
      ...(known.pronouns === undefined ? {} : { pronouns: known.pronouns }),
      ...(call === undefined ? {} : { voiceChannelName: call.name }),
      ...(member === undefined ? {} : { joinedAt: formatDate(member.joinedAt) }),
      ...(friend === undefined ? {} : { friendsSince: formatDate(friend.since) }),
      ...(request === undefined ? {} : { requestId: request.id }),
    };
  }, [
    userId,
    directory.members,
    directory.voiceChannels,
    friendList,
    requests,
    blocked,
    membership,
    user,
  ]);

  const anchor = profile.open?.anchor ?? null;
  if (vm === null || anchor === null) return null;

  const { requestId } = vm;
  const id = vm.person.id;

  /** Every action on the card answers it, and so ends it. */
  const thenClose = (action: () => void) => () => {
    action();
    profile.close();
  };
  const answerRequest = (answer: (requestId: string) => void) =>
    thenClose(() => {
      if (requestId !== undefined) answer(requestId);
    });

  return (
    <MiniProfile
      profile={vm}
      customEmoji={customEmoji}
      anchor={anchor}
      autoFocus={profile.open?.autoFocus ?? true}
      onClose={profile.close}
      onMessage={(text) => {
        friends.messagePerson(id, text);
        profile.close();
      }}
      onAddFriend={thenClose(() => void friends.addFriend(vm.username))}
      onUnblock={thenClose(() => friends.unblock(id))}
      onEditProfile={thenClose(() => ui.openModal("account"))}
      onAcceptRequest={answerRequest(friends.accept)}
      onDeclineRequest={answerRequest(friends.decline)}
      onCancelRequest={answerRequest(friends.cancel)}
    />
  );
}
