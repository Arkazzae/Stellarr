"use client";

import { Icon } from "@/components/icons/Icon";
import type {
  FriendRequestVM,
  FriendsTab,
  FriendVM,
  OpenProfile,
} from "@/components/view-models";
import type { MessageKey } from "@/i18n";
import { useLanguage } from "@/state/LanguageProvider";

import { BlockedRow } from "./BlockedRow";
import { FriendRow } from "./FriendRow";
import { TAB_LABEL } from "./FriendsTabList";
import { FriendsEmpty, FriendsSection } from "./FriendsSection";
import { RequestRow } from "./RequestRow";

/** What a row can do. Every row names a person, so every row opens their card. */
export interface FriendsListActions {
  onMessage: (userId: string) => void;
  onCall: (userId: string) => void;
  onRemove: (userId: string) => void;
  onBlock: (userId: string) => void;
  onUnblock: (userId: string) => void;
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
  onCancel: (requestId: string) => void;
  onOpenProfile: OpenProfile;
}

export interface FriendsListsProps extends FriendsListActions {
  tab: Exclude<FriendsTab, "add">;
  /** The search box as typed. */
  query: string;
  friends: FriendVM[];
  requests: FriendRequestVM[];
  blocked: FriendVM[];
  /** Opens the add-friend form. */
  onAddFriend: () => void;
  onClearSearch: () => void;
}

/** The list the selected tab stands for, with the empty state it falls back to. */
export function FriendsLists({
  tab,
  query,
  friends,
  requests,
  blocked,
  onAddFriend,
  onClearSearch,
  onMessage,
  onCall,
  onRemove,
  onBlock,
  onUnblock,
  onAccept,
  onDecline,
  onCancel,
  onOpenProfile,
}: FriendsListsProps) {
  const { t } = useLanguage();
  const typed = query.trim();
  const needle = typed.toLowerCase();

  const matching = (list: FriendVM[]) =>
    needle.length === 0
      ? list
      : list.filter(
          ({ person, username }) =>
            person.displayName.toLowerCase().includes(needle) ||
            username.toLowerCase().includes(needle),
        );

  // An empty list that only states its emptiness leaves the reader to work out
  // what to do about it, so each one carries the way out.
  const addAction = (
    <button type="button" className="btn-primary sm" onClick={onAddFriend}>
      <Icon name="userAdd" size={15} />
      {t("friends.addFriend")}
    </button>
  );
  const noMatches = (detail: MessageKey) => (
    <FriendsEmpty
      icon="search"
      title={t("friends.queryEmptyTitle")}
      detail={t(detail, { query: typed })}
      action={
        <button type="button" className="btn-ghost sm" onClick={onClearSearch}>
          {t("friends.clearSearch")}
        </button>
      }
    />
  );

  const friendRow = (friend: FriendVM, since: boolean) => (
    <FriendRow
      key={friend.person.id}
      person={friend.person}
      username={friend.username}
      detail={
        since && friend.since !== undefined
          ? t("friends.since", { date: friend.since })
          : undefined
      }
      onMessage={() => onMessage(friend.person.id)}
      onCall={() => onCall(friend.person.id)}
      onRemove={() => onRemove(friend.person.id)}
      onBlock={() => onBlock(friend.person.id)}
      onOpenProfile={(anchor) => onOpenProfile(friend.person.id, anchor)}
    />
  );

  const caption = t(TAB_LABEL[tab]);

  switch (tab) {
    case "online": {
      const online = matching(friends.filter((friend) => friend.person.presence !== "offline"));
      const nobody = friends.length === 0;
      return (
        <FriendsSection
          caption={caption}
          count={online.length}
          empty={
            needle.length > 0 ? (
              noMatches("friends.onlineQueryEmpty")
            ) : (
              <FriendsEmpty
                icon="wave"
                title={t(nobody ? "friends.allEmptyTitle" : "friends.onlineEmptyTitle")}
                detail={t(nobody ? "friends.allEmpty" : "friends.onlineEmpty")}
                action={addAction}
              />
            )
          }
        >
          {online.map((friend) => friendRow(friend, false))}
        </FriendsSection>
      );
    }
    case "all": {
      const everyone = matching(friends);
      return (
        <FriendsSection
          caption={caption}
          count={everyone.length}
          empty={
            needle.length > 0 ? (
              noMatches("friends.allQueryEmpty")
            ) : (
              <FriendsEmpty
                icon="users"
                title={t("friends.allEmptyTitle")}
                detail={t("friends.allEmpty")}
                action={addAction}
              />
            )
          }
        >
          {everyone.map((friend) => friendRow(friend, true))}
        </FriendsSection>
      );
    }
    case "pending":
      return (
        <FriendsSection
          caption={caption}
          count={requests.length}
          empty={
            <FriendsEmpty
              icon="send"
              title={t("friends.pendingEmptyTitle")}
              detail={t("friends.pendingEmpty")}
              action={addAction}
            />
          }
        >
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              onAccept={() => onAccept(request.id)}
              onDecline={() => onDecline(request.id)}
              onCancel={() => onCancel(request.id)}
              onOpenProfile={(anchor) => onOpenProfile(request.person.id, anchor)}
            />
          ))}
        </FriendsSection>
      );
    case "blocked": {
      const shown = matching(blocked);
      return (
        <FriendsSection
          caption={caption}
          count={shown.length}
          empty={
            needle.length > 0 ? (
              noMatches("friends.blockedQueryEmpty")
            ) : (
              // Not blocking anybody is already the state, so there is no
              // action to offer.
              <FriendsEmpty
                icon="ban"
                title={t("friends.blockedEmptyTitle")}
                detail={t("friends.blockedEmpty")}
              />
            )
          }
        >
          {shown.map((entry) => (
            <BlockedRow
              key={entry.person.id}
              entry={entry}
              onUnblock={() => onUnblock(entry.person.id)}
              onOpenProfile={(anchor) => onOpenProfile(entry.person.id, anchor)}
            />
          ))}
        </FriendsSection>
      );
    }
  }
}
