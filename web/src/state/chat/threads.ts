import { messageReference } from "@/lib/format";
import type { InterfaceLocale } from "@/i18n";
import type { Message, MessageReference, ThreadSummary } from "@/ports";

export const NO_THREADS: ThreadSummary[] = [];

/** Busiest conversation first. */
export function byLastReplyDesc(a: ThreadSummary, b: ThreadSummary): number {
  return (
    new Date(b.lastReplyAt).getTime() - new Date(a.lastReplyAt).getTime() ||
    a.root.id.localeCompare(b.root.id)
  );
}

export function sortThreads(threads: readonly ThreadSummary[]): ThreadSummary[] {
  return [...threads].sort(byLastReplyDesc);
}

export function isReply(
  message: Message,
): message is Message & { replyTo: MessageReference } {
  return message.replyTo !== undefined && message.replyTo !== null;
}

/**
 * Counts one more reply on its thread, opening the thread's row if this is the
 * first, and puts the thread that just heard something back on top.
 */
export function addThreadReply(
  current: readonly ThreadSummary[] | undefined,
  reply: Message & { replyTo: MessageReference },
): ThreadSummary[] {
  const bucket = current ?? NO_THREADS;
  const existing = bucket.find((thread) => thread.root.id === reply.replyTo.id);
  const summary: ThreadSummary = {
    channelId: reply.channelId,
    root: reply.replyTo,
    replyCount: (existing?.replyCount ?? 0) + 1,
    lastReplyAt: reply.createdAt,
  };
  const rows = existing === undefined
    ? [...bucket, summary]
    : bucket.map((thread) => (thread === existing ? summary : thread));
  return sortThreads(rows);
}

/**
 * Re-quotes the root of a thread after it was edited, so the rail does not
 * keep showing the old words. The same list when the message roots no thread.
 */
export function retitleRoot(
  threads: ThreadSummary[],
  root: Message,
  locale: InterfaceLocale,
): ThreadSummary[] {
  const at = threads.findIndex((thread) => thread.root.id === root.id);
  const existing = threads[at];
  if (existing === undefined) return threads;
  const next = [...threads];
  next[at] = { ...existing, root: messageReference(root, locale) };
  return next;
}
