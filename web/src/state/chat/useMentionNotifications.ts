import { useEffect, useRef } from "react";

import type { Translator } from "@/i18n";
import {
  notificationPreview,
  shouldShowMentionNotification,
} from "@/lib/notifications";
import { showMessageNotification } from "@/lib/notifications/browser";
import type { ChatPort, UserPreferences } from "@/ports";

interface MentionNotificationsOptions {
  chat: ChatPort;
  selfId: string | null;
  selfUsername: string | null;
  preferences: UserPreferences;
  /** The name of a text channel of this server, or null for one it does not know. */
  channelName: (channelId: string) => string | null;
  /** Pressing the notification lands on the channel the mention is in. */
  openChannel: (channelId: string) => void;
  t: Translator;
}

/** Away means not looking: another tab, another app, or the window minimised. */
function isAway(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

/**
 * A mention pops up over other apps while the person is away from Stellarr,
 * when they allowed system notifications. It has its own switch beside the
 * call's, so mentions can stay in the app while calls still pop up.
 *
 * It listens beside the chat feed rather than inside it: the feed puts the
 * message in the transcript and plays the sound, and neither needs to know
 * whether the window has focus.
 */
export function useMentionNotifications({
  chat,
  selfId,
  selfUsername,
  preferences,
  channelName,
  openChannel,
  t,
}: MentionNotificationsOptions): void {
  // Read when a message arrives, so a change of name, preference or language
  // does not resubscribe and cannot miss one in between.
  const latest = useRef({ selfId, selfUsername, preferences, channelName, openChannel, t });
  useEffect(() => {
    latest.current = { selfId, selfUsername, preferences, channelName, openChannel, t };
  });

  useEffect(
    () =>
      chat.onMessage((message) => {
        const now = latest.current;
        if (!shouldShowMentionNotification({
          authorId: message.author.id,
          channelId: message.channelId,
          content: message.content,
          selfId: now.selfId,
          selfUsername: now.selfUsername,
          enabled: now.preferences.mentionPopups,
          mutedChannelIds: now.preferences.mutedChannelIds,
          away: isAway(),
        })) {
          return;
        }

        const author = message.author.displayName;
        const channel = now.channelName(message.channelId);
        showMessageNotification({
          id: message.id,
          title: channel === null
            ? now.t("notifications.mentionTitle", { author })
            : now.t("notifications.systemMention", { author, channel }),
          body: notificationPreview(message.content),
          onOpen: () => latest.current.openChannel(message.channelId),
        });
      }),
    [chat],
  );
}
