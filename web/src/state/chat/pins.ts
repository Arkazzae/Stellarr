import type { Message, MessageSyncChange } from "@/ports";

/** Newest pin first: what someone opening the list is looking for. */
export function byPinnedAtDesc(a: Message, b: Message): number {
  return (
    new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime() ||
    a.id.localeCompare(b.id)
  );
}

export function sortPins(messages: readonly Message[]): Message[] {
  return [...messages].sort(byPinnedAtDesc);
}

/**
 * Applies a rewritten message to the pinned list: it leaves the list when it
 * is no longer pinned and joins, or moves, when it is. The same list comes
 * back when nothing changed, so an unrelated edit does not re-render the panel.
 */
export function applyPinEcho(pins: Message[], message: Message): Message[] {
  const without = pins.filter((item) => item.id !== message.id);
  const next = message.pinnedAt === undefined
    ? without
    : sortPins([message, ...without]);
  return next.length === pins.length && next.every((item, at) => item === pins[at])
    ? pins
    : next;
}

/** Replays a journal page over the pinned list. */
export function applyPinChanges(
  pins: Message[],
  changes: readonly MessageSyncChange[],
): Message[] {
  let next = pins;
  for (const change of changes) {
    next = next.filter((message) => message.id !== change.messageId);
    if (change.kind === "upsert" && change.message?.pinnedAt !== undefined) {
      next = sortPins([change.message, ...next]);
    }
  }
  return next;
}
