"use client";

import { useMemo } from "react";

import { DmRail } from "@/components/shell/DmRail";
import type { DmConversationVM } from "@/components/view-models";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { initials } from "@/lib/format";
import type { DmConversation } from "@/ports";
import { useFriends, useLanguage, useSession, useUi } from "@/state/hooks";

import { RailAccount, RailVoiceDock } from "./RailFooter";

type Translate = ReturnType<typeof useLanguage>["t"];

const inCall = (conversation: DmConversation) =>
  (conversation.callParticipants?.length ?? 0) > 0;

/**
 * What the rail's second line says about a conversation.
 *
 * Composed here rather than in the rail, because the answer depends on who is
 * speaking and on whether anything has been said at all.
 */
function previewOf(
  t: Translate,
  conversation: DmConversation,
  selfId: string,
): string {
  const { lastMessage } = conversation;
  const content = inCall(conversation)
    ? t("dm.callPreview")
    : lastMessage?.content;
  if (content === undefined) return t("dm.firstMessage");
  // The rail is one line; a pasted paragraph must not decide its height.
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return t("dm.attachment");
  return lastMessage?.author.id === selfId
    ? t("dm.youPrefix", { content: flat })
    : flat;
}

export function DmRailContainer() {
  const ui = useUi();
  const friends = useFriends();
  const { t } = useLanguage();
  const { user } = useSession();
  const selfId = user?.id ?? "";

  // Below 768 the rail is a drawer; shut, it is off screen and must be inert.
  const railIsDrawer = useMediaQuery("(max-width: 767px)", false);

  const conversations = useMemo<DmConversationVM[]>(
    () =>
      friends.conversations.map((conversation) => {
        const { peer } = conversation;
        return {
          id: conversation.id,
          peer: {
            id: peer.id,
            displayName: peer.displayName,
            initials: initials(peer.displayName),
            presence: peer.presence,
            // The face, not just the letters: the rail is the one list where a
            // conversation is recognised before its name is read.
            ...(peer.avatarUrl === undefined ? {} : { avatarUrl: peer.avatarUrl }),
          },
          preview: previewOf(t, conversation, selfId),
          unread: conversation.unread,
          ...(inCall(conversation) ? { callActive: true } : {}),
        };
      }),
    [friends.conversations, selfId, t],
  );

  return (
    <DmRail
      serversOpen={ui.serversOpen}
      onToggleServers={ui.toggleServers}
      onBackToServer={ui.openServer}
      friendsActive={ui.activeDmId === null}
      onOpenFriends={ui.openFriends}
      pending={friends.incoming}
      conversations={conversations}
      activeDmId={ui.activeDmId}
      onSelect={ui.openDm}
      onAddFriend={() => {
        ui.setFriendsTab("add");
        ui.openFriends();
      }}
      voiceDock={<RailVoiceDock />}
      account={<RailAccount />}
      hidden={railIsDrawer && !ui.railOpen}
    />
  );
}
