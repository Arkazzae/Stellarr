import { countUnread } from "@/lib/unread";
import type { Message } from "@/ports";

/**
 * Moves a channel's read mark forward. A mark never goes back: an echo of an
 * older read, arriving late from another tab, must not bring the badge back.
 */
export function advanceReadMark(
  marks: Readonly<Record<string, string>>,
  channelId: string,
  lastReadAt: string,
): Readonly<Record<string, string>> {
  const previous = marks[channelId];
  if (previous !== undefined && Date.parse(previous) >= Date.parse(lastReadAt)) {
    return marks;
  }
  return { ...marks, [channelId]: lastReadAt };
}

/**
 * Messages that arrived since each channel was last read, for the channels
 * that have any. A channel without a mark counts from `openedAt`, when this
 * tab started listening. The open channel is being read now and gets no entry.
 */
export function unreadCounts(
  messages: Readonly<Record<string, readonly Message[]>>,
  marks: Readonly<Record<string, string>>,
  openedAt: string,
  openChannelId: string | null,
  selfId: string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [channelId, bucket] of Object.entries(messages)) {
    if (channelId === openChannelId) continue;
    const count = countUnread(bucket, marks[channelId] ?? openedAt, selfId);
    if (count > 0) counts[channelId] = count;
  }
  return counts;
}
