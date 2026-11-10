/**
 * Where you left off.
 *
 * The server persists a per-channel read mark; unread counts are derived here
 * from that mark and the messages already loaded. Two rules keep the answer
 * useful: your own message means you were present, and a server notice is not
 * something anyone came back for.
 */

import type { Message } from "@/lib/api/types";

/** The author id the transcript renders as a server notice. */
const SYSTEM_AUTHOR_ID = "system";

/** What a block of messages must say about itself to be placed against the mark. */
export interface UnreadGroup {
  id: string;
  authorId: string;
  /** ISO 8601, of the block's first message. */
  timestamp: string;
  system?: boolean;
}

/**
 * Counts the messages that arrived after `mark`, leaving out your own and the
 * server's notices (a join would otherwise light a channel up).
 */
export function countUnread(
  messages: readonly Message[],
  mark: string,
  selfId: string | undefined,
): number {
  const since = new Date(mark).getTime();
  return messages.filter(
    (message) =>
      message.author.id !== selfId &&
      message.author.id !== SYSTEM_AUTHOR_ID &&
      new Date(message.createdAt).getTime() > since,
  ).length;
}

/**
 * Returns the id of the block the "new messages" line goes above, or null.
 *
 * The line sits between blocks, never inside one, so a single run of
 * conversation is not cut in half. A block of your own clears everything above
 * it: posting means you were here, whatever the mark says.
 */
export function findFirstUnreadGroup(
  groups: readonly UnreadGroup[],
  mark: string,
  selfId: string | undefined,
): string | null {
  const since = new Date(mark).getTime();
  let first: string | null = null;
  for (const group of groups) {
    if (new Date(group.timestamp).getTime() <= since) continue;
    if (group.authorId === selfId) {
      first = null;
    } else if (group.system !== true) {
      first ??= group.id;
    }
  }
  return first;
}
