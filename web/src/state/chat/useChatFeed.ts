import { useCallback, useEffect, useReducer, useState } from "react";

import type { InterfaceLocale } from "@/i18n";
import { playSystemFx } from "@/lib/audio/systemFx";
import { shouldPlayMessageNotificationSound } from "@/lib/notifications";
import type { Message, Ports, UserPreferences } from "@/ports";

import type { ChatDispatch } from "./shared";
import { refreshThreads } from "./useThreadCatalogue";

interface ChatFeedOptions {
  ports: Ports;
  dispatch: ChatDispatch;
  locale: InterfaceLocale;
  /** A message was deleted; composer state pointing at it must go. */
  onRemoved: (messageId: string) => void;
  selfId: string | null;
  selfUsername: string | null;
  openChannelId: string | null;
  preferences: UserPreferences;
}

/**
 * Subscribes the store to everything the server pushes while the app is open.
 *
 * @returns who is typing in each channel, and a counter that changes whenever
 * a reaction does, since the transcript reads reactions from the port.
 */
export function useChatFeed({
  ports,
  dispatch,
  locale,
  onRemoved,
  selfId,
  selfUsername,
  openChannelId,
  preferences,
}: ChatFeedOptions): {
  typing: Readonly<Record<string, string[]>>;
  reactionEpoch: number;
} {
  const [typing, setTyping] = useState<Record<string, string[]>>({});
  const [reactionEpoch, bumpReactions] = useReducer((n: number) => n + 1, 0);

  const receive = useCallback(
    (message: Message) => {
      dispatch({ type: "received", message });
      // The visible transcript is feedback enough. Sound only calls attention
      // to a real incoming message elsewhere, never to our echoed send.
      if (shouldPlayMessageNotificationSound({
        authorId: message.author.id,
        channelId: message.channelId,
        content: message.content,
        selfId,
        selfUsername,
        openChannelId,
        soundEnabled: preferences.messageSound,
        mentionsOnly: preferences.mentionsOnly,
        mutedChannelIds: preferences.mutedChannelIds,
      })) {
        playSystemFx("notification");
      }
    },
    [dispatch, selfId, selfUsername, openChannelId, preferences],
  );

  // One subscription for the whole session: the backend's server group fires
  // for every text channel, including rooms this tab has not opened yet.
  useEffect(() => ports.chat.onMessage(receive), [ports, receive]);

  // An edit, from anywhere: this tab gets the echo like everyone else. Pinning
  // is an update too, and this is the only echo of it.
  useEffect(
    () =>
      ports.chat.onMessageUpdated((message) =>
        dispatch({ type: "updated", message, locale })),
    [ports, dispatch, locale],
  );

  // A deleted message leaves the transcript, and anything still pointing at it
  // goes too: a reply bar naming a message that no longer exists would send an
  // answer to nothing.
  useEffect(
    () =>
      ports.chat.onMessageDeleted(({ messageId, channelId }) => {
        dispatch({ type: "deleted", channelId, messageId });
        onRemoved(messageId);
        void refreshThreads(ports.chat, dispatch, channelId).catch(() => undefined);
      }),
    [ports, dispatch, onRemoved],
  );

  // Cards arrive seconds after the message they belong to. They are merged into
  // the message rather than kept beside it, so a re-fetch cannot disagree with
  // a push.
  useEffect(
    () =>
      ports.chat.onEmbedsUpdated(({ messageId, channelId, embeds }) =>
        dispatch({ type: "embeds", channelId, messageId, embeds })),
    [ports, dispatch],
  );

  useEffect(
    () =>
      ports.typing.onTypingChanged((channelId, displayNames) => {
        setTyping((current) => ({ ...current, [channelId]: displayNames }));
      }),
    [ports],
  );

  useEffect(
    () => ports.messageActions.onReactionsChanged(() => bumpReactions()),
    [ports],
  );

  return { typing, reactionEpoch };
}
