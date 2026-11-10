"use client";

import { useMemo } from "react";

import { Roster, type RosterMenu } from "@/components/roster/Roster";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  useDirectory,
  useFriends,
  useProfile,
  useSession,
  useUi,
  useVoice,
} from "@/state/hooks";

import { relationTo } from "./relationTo";
import { useMemberMenu } from "./useMemberMenu";

export function RosterContainer() {
  const { people, inVoice } = useDirectory();
  const { applySpeaking } = useVoice();
  const ui = useUi();
  const profile = useProfile();
  const friends = useFriends();
  const { user } = useSession();
  const memberMenu = useMemberMenu();

  // From 1024 up, a closed list is the avatar column, not "no roster"; the
  // shell paints the track, the panel still has to know it is on screen.
  const wide = useMediaQuery("(min-width: 1024px)", true);

  // Presence is the only grouping. Voice state decorates a row with its
  // speaking ring but does not pull the person into a category of their own,
  // which would reshuffle the list whenever someone joins or leaves a call.
  const { online, offline, voiceUserIds } = useMemo(() => {
    const speakers = new Map(applySpeaking(inVoice).map((person) => [person.id, person]));
    const presented = people.map((person) => speakers.get(person.id) ?? person);
    return {
      online: presented.filter((person) => person.presence !== "offline"),
      offline: presented.filter((person) => person.presence === "offline"),
      voiceUserIds: new Set(speakers.keys()),
    };
  }, [people, inVoice, applySpeaking]);

  const menu: RosterMenu = {
    ...memberMenu,
    relationOf: (userId) => relationTo(userId, user?.id, friends),
    onAddFriend: (userId) => {
      const person = people.find((candidate) => candidate.id === userId);
      if (person !== undefined) void friends.addFriend(person.displayName);
    },
    onRemoveFriend: friends.remove,
    onBlock: friends.block,
    onUnblock: friends.unblock,
    ...(user === null ? {} : { selfId: user.id }),
  };

  // A conversation has no channel roster, and the grid gives the track no
  // width there, so the panel leaves the tab order and the accessibility tree
  // as well as the screen instead of lurking at zero pixels.
  const inServer = ui.space === "server";

  return (
    <Roster
      open={inServer && ui.rosterOpen}
      mini={inServer && wide && !ui.rosterOpen}
      online={online}
      offline={offline}
      voiceUserIds={voiceUserIds}
      onExpand={() => ui.setRosterOpen(true)}
      onCollapse={() => ui.setRosterOpen(false)}
      onOpenProfile={profile.toggle}
      menu={menu}
    />
  );
}
