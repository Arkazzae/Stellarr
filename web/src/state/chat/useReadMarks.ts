import { useCallback, useEffect, useMemo, useState } from "react";

import type { ChatPort, Message } from "@/ports";

import { advanceReadMark, unreadCounts } from "./readMarks";

interface ReadMarksOptions {
  chat: ChatPort;
  channelId: string | null;
  messages: Readonly<Record<string, readonly Message[]>>;
  selfId: string | undefined;
}

/**
 * Where the reader left off in every channel.
 *
 * Leaving a channel is what marks it read, not arriving at it. Advancing the
 * mark on arrival would erase the "new messages" line before it was seen.
 */
export function useReadMarks({ chat, channelId, messages, selfId }: ReadMarksOptions) {
  /** Durable per-channel watermarks, initially seeded by bootstrap. */
  const [marks, setMarks] = useState<Readonly<Record<string, string>>>(() => ({
    ...chat.getReadState(),
  }));
  /** State, not a ref: the counts below are computed while rendering. */
  const [openedAt] = useState(() => new Date().toISOString());

  useEffect(
    () =>
      chat.onChannelReadChanged((id, lastReadAt) => {
        setMarks((current) => advanceReadMark(current, id, lastReadAt));
      }),
    [chat],
  );

  const markChannelRead = useCallback(
    (id: string) => {
      const markedAt = new Date().toISOString();
      setMarks((current) => ({ ...current, [id]: markedAt }));
      void chat.markChannelRead(id).catch(() => {
        // Keep the optimistic local mark. The next successful read or
        // bootstrap reconciles it, while snapping the rail back would make a
        // transient network failure look like new messages arriving again.
      });
    },
    [chat],
  );

  // The cleanup runs when `channelId` changes, so the mark lands on the
  // channel being left, at the moment it stops being on screen.
  useEffect(() => {
    if (channelId === null) return;
    const leaving = channelId;
    return () => markChannelRead(leaving);
  }, [channelId, markChannelRead]);

  const unreadByChannel = useMemo(
    () => unreadCounts(messages, marks, openedAt, channelId, selfId),
    [messages, marks, openedAt, channelId, selfId],
  );

  // The open channel's mark: the line stays put until the channel is left.
  const openMark = channelId === null ? null : (marks[channelId] ?? openedAt);

  return useMemo(
    () => ({ unreadByChannel, markChannelRead, openMark }),
    [unreadByChannel, markChannelRead, openMark],
  );
}
