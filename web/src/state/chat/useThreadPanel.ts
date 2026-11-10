import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import type { InterfaceLocale } from "@/i18n";
import { messageReference } from "@/lib/format";
import type {
  ChatPort,
  Message,
  MessageReference,
  ThreadSummary,
} from "@/ports";

import type { ChatDispatch } from "./shared";

interface ThreadPanelOptions {
  chat: ChatPort;
  channelId: string | null;
  locale: InterfaceLocale;
  /** The open channel's loaded messages, where a thread's root is found. */
  messages: readonly Message[];
  dispatch: ChatDispatch;
  selectTextChannel: (channelId: string) => void;
  closeChannelPanel: () => void;
}

/**
 * The thread beside the transcript, and the message the composer answers.
 *
 * They live together because an open thread decides the reply target: while
 * it is open, everything typed answers its root unless another message is
 * picked.
 */
export function useThreadPanel({
  chat,
  channelId,
  locale,
  messages,
  dispatch,
  selectTextChannel,
  closeChannelPanel,
}: ThreadPanelOptions) {
  const [replyingTo, setReplyingTo] = useState<MessageReference | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [initialExpanded, setInitialExpanded] = useState(false);
  const [openRevision, bumpOpenRevision] = useReducer((n: number) => n + 1, 0);
  const [request, setRequest] = useState<ThreadSummary | null>(null);
  const [openingThreadId, setOpeningThreadId] = useState<string | null>(null);

  /*
   * A draft reply belongs to the channel it was started in.
   *
   * Adjusted during render rather than in an effect, React's own escape hatch
   * for state derived from props, so the composer never paints one channel's
   * reply bar over another channel's transcript for a frame.
   */
  const [replyChannel, setReplyChannel] = useState(channelId);
  if (replyChannel !== channelId) {
    setReplyChannel(channelId);
    setReplyingTo(null);
    setRootId(null);
    setInitialExpanded(false);
    if (request !== null && request.channelId !== channelId) {
      setRequest(null);
      setOpeningThreadId(null);
    }
  }

  /** Changes channel when needed; the thread itself opens once it is read. */
  const openThread = useCallback(
    (summary: ThreadSummary) => {
      setRequest(summary);
      setOpeningThreadId(summary.root.id);
      closeChannelPanel();
      selectTextChannel(summary.channelId);
    },
    [closeChannelPanel, selectTextChannel],
  );

  useEffect(() => {
    if (request === null || request.channelId !== channelId) return;
    let current = true;
    void chat
      .getThread(request.channelId, request.root.id)
      .then((threadMessages) => {
        if (!current) return;
        const root = threadMessages.find((message) => message.id === request.root.id);
        if (root === undefined) return;
        dispatch({
          type: "thread-opened",
          channelId: request.channelId,
          messages: threadMessages,
        });
        setInitialExpanded(true);
        bumpOpenRevision();
        setRootId(root.id);
        setReplyingTo(messageReference(root, locale));
      })
      // Keep the rail usable. A later click retries the complete thread read.
      .catch(() => undefined)
      .finally(() => {
        if (!current) return;
        setRequest(null);
        setOpeningThreadId(null);
      });
    return () => {
      current = false;
    };
  }, [chat, channelId, locale, request, dispatch]);

  /** Opens a thread whose root is already in the transcript. */
  const showThread = useCallback(
    (messageId: string) => {
      setInitialExpanded(false);
      bumpOpenRevision();
      setRootId(messageId);
      closeChannelPanel();
      const root = messages.find((message) => message.id === messageId);
      if (root !== undefined) setReplyingTo(messageReference(root, locale));
    },
    [messages, locale, closeChannelPanel],
  );

  const closeThread = useCallback(() => {
    setRequest(null);
    setOpeningThreadId(null);
    setRootId(null);
    setInitialExpanded(false);
    setReplyingTo(null);
  }, []);

  const startReply = useCallback(
    (messageId: string) => {
      const answered = messages.find((message) => message.id === messageId);
      if (answered !== undefined) setReplyingTo(messageReference(answered, locale));
    },
    [messages, locale],
  );

  const threadReply = useMemo(() => {
    if (rootId === null) return null;
    const root = messages.find((message) => message.id === rootId);
    return root === undefined ? null : messageReference(root, locale);
  }, [messages, locale, rootId]);

  const cancelReply = useCallback(() => setReplyingTo(null), []);

  /** After a send: back to the thread's root, or to no reply at all. */
  const settleReply = useCallback(() => setReplyingTo(threadReply), [threadReply]);

  /** A message was deleted: stop answering it. */
  const forgetReply = useCallback(
    (messageId: string) =>
      setReplyingTo((current) => (current?.id === messageId ? null : current)),
    [],
  );

  /** A message was deleted: close the thread it rooted. */
  const forgetThread = useCallback(
    (messageId: string) =>
      setRootId((current) => (current === messageId ? null : current)),
    [],
  );

  // Who the composer answers: the open thread's root unless another is picked.
  const replyTarget = threadReply ?? replyingTo;

  return useMemo(
    () => ({
      replyTarget,
      replyingTo,
      threadRootId: rootId,
      threadInitialExpanded: initialExpanded,
      threadOpenRevision: openRevision,
      openingThreadId,
      openThread,
      showThread,
      closeThread,
      startReply,
      cancelReply,
      settleReply,
      forgetReply,
      forgetThread,
    }),
    [
      replyTarget,
      replyingTo,
      rootId,
      initialExpanded,
      openRevision,
      openingThreadId,
      openThread,
      showThread,
      closeThread,
      startReply,
      cancelReply,
      settleReply,
      forgetReply,
      forgetThread,
    ],
  );
}
