import type { Message, MessageSyncChange } from "@/ports";

export const NO_MESSAGES: Message[] = [];

/** Oldest first; the id breaks a tie so two messages never swap on a re-sort. */
export function byCreatedAt(a: Message, b: Message): number {
  return (
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Adds `message` to a channel's bucket.
 *
 * The sender appends the POST answer *and* receives `MessageCreated`, so the id
 * is the identity: the second arrival replaces the first in place rather than
 * doubling it. Only a genuinely new message is placed by time.
 */
export function mergeMessage(
  bucket: Message[] | undefined,
  message: Message,
): Message[] {
  const existing = bucket ?? NO_MESSAGES;
  const at = existing.findIndex((item) => item.id === message.id);
  if (at !== -1) {
    const next = [...existing];
    next[at] = message;
    return next;
  }
  return [...existing, message].sort(byCreatedAt);
}

export function mergeAll(
  bucket: Message[] | undefined,
  messages: readonly Message[],
): Message[] {
  return messages.reduce(mergeMessage, bucket ?? NO_MESSAGES);
}

/**
 * Replaces the newest server-owned window while retaining older pages and the
 * optimistic sends that have not reached the server yet.
 */
export function reconcileLatest(
  current: Message[] | undefined,
  latest: readonly Message[],
  pendingIds: ReadonlySet<string>,
): Message[] {
  const serverIds = new Set(latest.map((message) => message.id));
  const oldest = latest.length === 0
    ? Number.NEGATIVE_INFINITY
    : Math.min(...latest.map((message) => Date.parse(message.createdAt)));
  const retained = (current ?? NO_MESSAGES).filter(
    (message) =>
      pendingIds.has(message.id) ||
      serverIds.has(message.id) ||
      Date.parse(message.createdAt) < oldest,
  );
  return mergeAll(retained, latest);
}

/**
 * The window after the server compacted the journal this client was resuming:
 * nothing already held can be trusted, so only the unsent messages survive
 * underneath the fresh page.
 */
export function resetWindow(
  current: Message[] | undefined,
  fresh: readonly Message[],
  pendingIds: ReadonlySet<string>,
): Message[] {
  const unsent = (current ?? NO_MESSAGES).filter((message) =>
    pendingIds.has(message.id));
  return mergeAll(unsent, fresh);
}

/** Replays a journal page, in order, over a bucket. */
export function applySyncChanges(
  bucket: Message[] | undefined,
  changes: readonly MessageSyncChange[],
): Message[] {
  let next = bucket ?? NO_MESSAGES;
  for (const change of changes) {
    next = change.kind === "delete" || change.message === undefined
      ? next.filter((message) => message.id !== change.messageId)
      : mergeMessage(next, change.message);
  }
  return next;
}

/** The same bucket, untouched, when the message is not in it. */
export function removeMessage(bucket: Message[], messageId: string): Message[] {
  const next = bucket.filter((message) => message.id !== messageId);
  return next.length === bucket.length ? bucket : next;
}

/**
 * Rewrites a message that is already loaded; the same bucket when it is not.
 * A message nobody has loaded needs no patch, since opening the channel reads
 * it with the change already in.
 */
export function updateLoaded(
  bucket: Message[],
  messageId: string,
  change: (message: Message) => Message,
): Message[] {
  const at = bucket.findIndex((message) => message.id === messageId);
  const existing = bucket[at];
  if (existing === undefined) return bucket;
  const next = [...bucket];
  next[at] = change(existing);
  return next;
}

/**
 * The server's copy takes the placeholder's place in one update, so the row
 * carries the real id and timestamp without blinking twice.
 */
export function settleOptimistic(
  bucket: Message[] | undefined,
  placeholderId: string,
  message: Message,
): Message[] {
  const without = (bucket ?? NO_MESSAGES).filter(
    (item) => item.id !== placeholderId,
  );
  return mergeMessage(without, message);
}
