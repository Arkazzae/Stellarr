"use client";

import { useMemo } from "react";

import { DmRoom } from "@/components/friends/DmRoom";
import { FriendsView } from "@/components/friends/FriendsView";
import { MediaViewer } from "@/components/room/MediaViewer";
import type {
  FriendRequestVM,
  FriendVM,
  PersonVM,
} from "@/components/view-models";
import { formatAgo, formatDate, initials } from "@/lib/format";
import type { User } from "@/ports";
import {
  useEmoji,
  useFriends,
  useLanguage,
  useProfile,
  useSession,
  useUi,
  useVoice,
} from "@/state/hooks";

import { NotificationInboxButton } from "./NotificationInboxContainer";
import { FriendsActivityContainer } from "./FriendsActivityContainer";
import { useAttachmentViewer } from "./useAttachmentViewer";
import { useChatTranslation } from "./useChatTranslation";

/**
 * How long a video call waits before switching the camera on. The camera can
 * only be toggled once the call exists, and the join starts just before it.
 */
const CAMERA_AFTER_JOIN_MS = 500;

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
 * What the room shows on the messages side of the app: one conversation, or
 * the list of people, never both. The rail already says who else is there, and
 * a second copy of it beside an open conversation would be a fourth column.
 */
export function FriendsRoomContainer() {
  const ui = useUi();
  const friends = useFriends();
  const profile = useProfile();
  const voice = useVoice();
  const { user } = useSession();
  const { emoji: customEmoji } = useEmoji();
  const { locale } = useLanguage();
  const translation = useChatTranslation(friends.active?.id);
  // A conversation carries the same pictures, clips and recordings as a text
  // channel, so it opens them in the same viewer.
  const viewer = useAttachmentViewer(user?.id ?? "stellarr");

  const friendList = useMemo<FriendVM[]>(
    () =>
      friends.friends
        .map((friend) => ({
          person: toPerson(friend.user),
          username: friend.user.username,
          since: formatDate(friend.since, locale),
        }))
        .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName, locale)),
    [friends.friends, locale],
  );

  const requests = useMemo<FriendRequestVM[]>(
    () =>
      friends.requests.map((request) => ({
        id: request.id,
        person: toPerson(request.user),
        username: request.user.username,
        direction: request.direction,
        when: formatAgo(request.sentAt, new Date(), locale),
      })),
    [friends.requests, locale],
  );

  const blocked = useMemo<FriendVM[]>(
    () => friends.blocked.map((person) => ({ person: toPerson(person), username: person.username })),
    [friends.blocked],
  );

  const conversation = friends.active;
  if (conversation !== null) {
    const inCall = voice.channelId === conversation.id;
    return (
      <>
        <DmRoom
          peer={toPerson(conversation.peer)}
          sections={friends.sections}
          railOpen={ui.railOpen}
          onToggleRail={ui.toggleRail}
          onSend={friends.send}
          hasOlderMessages={friends.hasOlderMessages}
          loadingOlderMessages={friends.loadingOlderMessages}
          onLoadOlderMessages={friends.loadOlderMessages}
          callActive={(conversation.callParticipants?.length ?? 0) > 0}
          inCall={inCall}
          onCall={() => friends.callConversation(conversation.id)}
          videoOn={voice.call?.cameraOn ?? false}
          onVideoCall={() => {
            if (inCall) {
              voice.toggleCamera();
              return;
            }
            friends.callConversation(conversation.id);
            window.setTimeout(voice.toggleCamera, CAMERA_AFTER_JOIN_MS);
          }}
          callPeople={voice.people}
          cameraStreams={voice.cameraStreams}
          localPersonId={user?.id ?? ""}
          participantVolumes={voice.participantVolumes}
          onParticipantVolumeChange={voice.setParticipantVolume}
          participantGates={voice.participantGates}
          onParticipantGateChange={voice.setParticipantGate}
          participantSuppressions={voice.participantSuppressions}
          onParticipantSuppressionChange={voice.setParticipantSuppression}
          chips={friends.chips}
          onAttach={friends.attach}
          onRemoveChip={friends.removeChip}
          onRetryChip={friends.retryChip}
          onReorderChips={friends.reorderChips}
          onOpenProfile={profile.toggle}
          customEmoji={customEmoji}
          translation={translation}
          attachments={viewer.attachments}
          notificationButton={<NotificationInboxButton />}
        />
        <MediaViewer target={viewer.target} onClose={viewer.close} />
      </>
    );
  }

  return (
    <FriendsView
      tab={ui.friendsTab}
      onTabChange={ui.setFriendsTab}
      friends={friendList}
      requests={requests}
      blocked={blocked}
      railOpen={ui.railOpen}
      onToggleRail={ui.toggleRail}
      onMessage={friends.messagePerson}
      onCall={friends.callPerson}
      onRemove={friends.remove}
      onBlock={friends.block}
      onUnblock={friends.unblock}
      onAccept={friends.accept}
      onDecline={friends.decline}
      onCancel={friends.cancel}
      onAddFriend={friends.addFriend}
      onOpenProfile={profile.toggle}
      notificationButton={<NotificationInboxButton />}
      activityPanel={<FriendsActivityContainer />}
    />
  );
}
