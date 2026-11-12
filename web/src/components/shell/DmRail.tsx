"use client";

import { useId, useState, type ReactNode } from "react";

import { Icon } from "@stellarr/ui/icons";
import { Avatar } from "@/components/primitives/Avatar";
import type { DmConversationVM } from "@/components/view-models";
import { PRESENCE_LABEL } from "@/ports";
import { useLanguage } from "@/state/hooks";

/**
 * A row shows the last message rather than a status, so the presence dot is the
 * only sign of whether the person is around. It needs a word behind it for
 * anyone who cannot see the colour.
 */
export interface DmRailProps {
  /** Returns directly to the last selected server channel. */
  onBackToServer: () => void;
  /** True while the Friends view is showing rather than a conversation. */
  friendsActive: boolean;
  onOpenFriends: () => void;
  /** Incoming friend requests waiting for an answer; the badge on the Friends row. */
  pending: number;
  conversations: DmConversationVM[];
  activeDmId: string | null;
  onSelect: (id: string) => void;
  /** Opens the Friends view on its "add a friend" tab. */
  onAddFriend: () => void;
  /** `<VoiceDock>`, composed by the container. */
  voiceDock?: ReactNode;
  /** `<AccountRow>`, composed by the container. */
  account?: ReactNode;
  /**
   * Below 768 the rail is an off-screen drawer while shut. Off screen must
   * also mean out of the tab order and off the accessibility tree, the same
   * way the roster handles it.
   */
  hidden?: boolean;
}

interface ConversationRowProps {
  conversation: DmConversationVM;
  current: boolean;
  onSelect: (id: string) => void;
}

function ConversationRow({ conversation, current, onSelect }: ConversationRowProps) {
  const { t } = useLanguage();
  const { peer } = conversation;
  const presence = t(PRESENCE_LABEL[peer.presence]);

  return (
    <li className={conversation.unread > 0 ? "dm-item unread" : "dm-item"}>
      <button
        type="button"
        className="dm-row"
        aria-current={current ? "page" : undefined}
        onClick={() => onSelect(conversation.id)}
      >
        <Avatar
          id={peer.id}
          displayName={peer.displayName}
          initials={peer.initials}
          avatarUrl={peer.avatarUrl}
          presence={peer.presence}
          title={presence}
        />
        <span className="dm-txt">
          <b>{peer.displayName}</b>
          <span className="sr-only">{presence}</span>
          <span className="dm-last">{conversation.preview}</span>
        </span>
        {conversation.unread > 0 ? (
          <span className="dm-unread">
            {conversation.unread}
            <span className="sr-only">{t("shell.unreadConversation")}</span>
          </span>
        ) : conversation.callActive ? (
          <span
            className="dm-call-live"
            title={t("shell.activeCall")}
            aria-label={t("shell.activeCall")}
          >
            <Icon name="phone" size={14} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

/**
 * The rail on the messages side of the app.
 *
 * It is the same column, with the same 52px header and account row, as the
 * server rail: the two are one panel showing different contents. What changes
 * is what a row is. A channel is a place; a conversation is a person, so its
 * row carries a face, a presence ring and the last thing that was said.
 *
 * Friends sits in the header rather than in the list because it is not one of
 * the conversations; it is where you go when you do not want one of them.
 */
export function DmRail({
  onBackToServer,
  friendsActive,
  onOpenFriends,
  pending,
  conversations,
  activeDmId,
  onSelect,
  onAddFriend,
  voiceDock,
  account,
  hidden = false,
}: DmRailProps) {
  const { t } = useLanguage();
  const searchId = useId();
  const [query, setQuery] = useState("");

  const typed = query.trim();
  const needle = typed.toLowerCase();
  const shown = conversations.filter((conversation) =>
    conversation.peer.displayName.toLowerCase().includes(needle),
  );

  return (
    <nav
      className="rail dm-rail"
      aria-label={t("shell.friendsAndMessages")}
      // `inert` alone keeps the drawer out of the tab order and the
      // accessibility tree. Toggling `aria-hidden` as well would warn about a
      // focused descendant when the click that closes the rail is still active.
      inert={hidden}
    >
      <div className="rail-header">
        <button
          type="button"
          className="rail-switch dm-back"
          title={t("shell.returnToServer")}
          aria-label={t("shell.returnToServer")}
          onClick={onBackToServer}
        >
          <Icon name="caretL" size={17} />
        </button>
        <button
          type="button"
          className="dm-home"
          aria-current={friendsActive ? "page" : undefined}
          onClick={onOpenFriends}
        >
          <span className="glyph" aria-hidden="true">
            <Icon name="users" size={17} />
          </span>
          <span className="name">{t("friends.title")}</span>
          {pending > 0 ? (
            <span className="badge">
              {pending}
              <span className="sr-only">
                {pending === 1
                  ? t("shell.pendingInvite.one")
                  : t("shell.pendingInvite.many")}
              </span>
            </span>
          ) : null}
        </button>
      </div>

      <div className="dm-find">
        <label className="sr-only" htmlFor={searchId}>
          {t("shell.findConversation")}
        </label>
        <span className="glyph" aria-hidden="true">
          <Icon name="search" size={15} />
        </span>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder={t("shell.findConversation")}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="rail-scroll">
        <div className="group-caption">
          {t("shell.privateMessages")}
          <button
            type="button"
            className="cap-act"
            title={t("shell.addFriend")}
            aria-label={t("shell.addFriend")}
            onClick={onAddFriend}
          >
            <Icon name="userAdd" size={15} />
          </button>
        </div>

        {shown.length > 0 ? (
          <ul className="dm-list">
            {shown.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                current={conversation.id === activeDmId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : (
          <p className="dm-empty">
            {conversations.length === 0
              ? t("shell.noConversations")
              : t("shell.noConversationMatch", { query: typed })}
          </p>
        )}
      </div>

      {voiceDock}
      {account}
    </nav>
  );
}
