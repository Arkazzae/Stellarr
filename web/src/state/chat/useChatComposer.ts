import { useCallback, useMemo, useRef, useState } from "react";

import { giphyIdFromUrl } from "@/lib/giphy";
import type {
  Attachment,
  ChatPort,
  MessageReference,
  User,
} from "@/ports";

import { allUploaded, uploadedAttachments, type PendingChip } from "./pendingChips";
import {
  clearFailed,
  clientIdFor,
  optimisticMessage,
  publishFingerprint,
  toSendMessage,
  type FailedPublish,
} from "./publish";
import type { ChatDispatch, PendingIds } from "./shared";

interface ComposerOptions {
  chat: ChatPort;
  channelId: string | null;
  user: User | null;
  dispatch: ChatDispatch;
  pendingIds: PendingIds;
  /** The queued attachments, with their upload state. */
  pending: readonly PendingChip[];
  /** Drops queued attachments once their message went out. */
  discardChips: (ids: ReadonlySet<string>) => void;
  replyTarget: MessageReference | null;
  /** After a confirmed send, the reply bar goes back to where it started. */
  settleReply: () => void;
}

/**
 * Sending: text with its queued files, standalone recordings and GIFs.
 *
 * Every send path reaches `publish`, which shows the message at once under a
 * client-generated id and swaps in the server's copy when it answers.
 */
export function useChatComposer({
  chat,
  channelId,
  user,
  dispatch,
  pendingIds,
  pending,
  discardChips,
  replyTarget,
  settleReply,
}: ComposerOptions) {
  /**
   * Bumped the moment one of your own messages enters the list. A token rather
   * than a boolean, because two sends in a row have to be two distinct events.
   */
  const [ownSendToken, setOwnSendToken] = useState(0);
  const failedPublish = useRef<FailedPublish | null>(null);

  const publish = useCallback(
    async (text: string, attachments: Attachment[], answering: MessageReference | null) => {
      if (channelId === null || user === null) return;
      const fingerprint = publishFingerprint(channelId, text, attachments, answering);
      const clientMessageId = clientIdFor(failedPublish.current, fingerprint);
      const outgoing = { channelId, text, attachments, answering, clientMessageId };

      pendingIds.current.add(clientMessageId);
      dispatch({ type: "shown", message: optimisticMessage(outgoing, user) });
      setOwnSendToken((value) => value + 1);

      try {
        const message = await chat.send(toSendMessage(outgoing));
        failedPublish.current = clearFailed(failedPublish.current, clientMessageId);
        dispatch({ type: "settled", channelId, placeholderId: clientMessageId, message });
        pendingIds.current.delete(clientMessageId);
      } catch (error) {
        failedPublish.current = { fingerprint, clientMessageId };
        pendingIds.current.delete(clientMessageId);
        dispatch({ type: "dropped", channelId, messageId: clientMessageId });
        throw error;
      }
    },
    [chat, channelId, user, dispatch, pendingIds],
  );

  const send = useCallback(
    async (text: string) => {
      if (channelId === null || user === null) return;
      if (!allUploaded(pending)) {
        throw new Error("Attachments are still uploading or need a retry.");
      }
      const attachments = uploadedAttachments(pending);
      if (text.length === 0 && attachments.length === 0) return;

      await publish(text, attachments, replyTarget);
      // Only a confirmed send consumes its attachments and its reply. On
      // failure the uploaded chips and the answered message remain available
      // for a retry.
      discardChips(new Set(pending.map((chip) => chip.id)));
      settleReply();
    },
    [channelId, user, pending, publish, replyTarget, discardChips, settleReply],
  );

  const sendVoice = useCallback(
    async (file: File, durationSeconds: number) => {
      if (channelId === null || user === null) return;
      if (pending.length > 0) {
        throw new Error("A voice message must be sent without other attachments.");
      }
      const attachment = await chat.uploadAttachment(file, {
        voiceMessage: true,
        durationSeconds,
      });
      await publish("", [attachment], replyTarget);
      settleReply();
    },
    [channelId, user, pending.length, chat, publish, replyTarget, settleReply],
  );

  const sendGif = useCallback(
    async (pageUrl: string) => {
      if (channelId === null || user === null) {
        throw new Error("No active chat channel.");
      }
      if (giphyIdFromUrl(pageUrl) === null) {
        throw new Error("Not a canonical GIPHY GIF URL.");
      }
      // A GIF is independent of the current draft and queued files. The
      // canonical page is persisted; readers resolve the media straight from
      // GIPHY, so Stellarr never proxies or caches it.
      await publish(pageUrl, [], replyTarget);
      settleReply();
    },
    [channelId, user, publish, replyTarget, settleReply],
  );

  return useMemo(
    () => ({ ownSendToken, send, sendVoice, sendGif }),
    [ownSendToken, send, sendVoice, sendGif],
  );
}
