import type { MessageGroupVM } from "./MessageGroup";

export interface TranscriptSectionVM {
  /** Day heading, already localised — `formatDay` produces these. */
  day: string;
  groups: MessageGroupVM[];
}

export type Row =
  | { kind: "day"; id: string; day: string }
  | { kind: "unread"; id: string }
  | { kind: "group"; id: string; group: MessageGroupVM };

/**
 * Flattens the day/group tree into the flat list the virtualiser works on.
 *
 * Separators are rows of their own rather than wrappers around a day: a wrapper
 * is one indivisible item to the list, and a day with four hundred messages in
 * it would defeat the virtualisation.
 */
export function toRows(
  sections: readonly TranscriptSectionVM[],
  firstUnreadGroupId: string | null,
): Row[] {
  const rows: Row[] = [];
  for (const { day, groups } of sections) {
    rows.push({ kind: "day", id: `day-${day}`, day });
    for (const group of groups) {
      // The line belongs between two blocks, and the virtualiser measures whole
      // rows, so it cannot be a class on the block that follows it.
      if (group.id === firstUnreadGroupId) {
        rows.push({ kind: "unread", id: `unread-${group.id}` });
      }
      rows.push({ kind: "group", id: group.id, group });
    }
  }
  return rows;
}

/** What the end of the transcript looks like, to tell an arrival from a reload. */
export interface MessageTail {
  count: number;
  lastMessageId: string | undefined;
}

export function messageTail(rows: readonly Row[]): MessageTail {
  let count = 0;
  let lastMessageId: string | undefined;
  for (const row of rows) {
    if (row.kind !== "group") continue;
    count += row.group.bodies.length;
    lastMessageId = row.group.bodies.at(-1)?.id ?? lastMessageId;
  }
  return { count, lastMessageId };
}

/** The row holding the message (or the block) with this id, or -1. */
export function indexOfMessage(rows: readonly Row[], messageId: string): number {
  return rows.findIndex(
    (row) =>
      row.kind === "group" &&
      (row.id === messageId ||
        row.group.bodies.some((body) => body.id === messageId)),
  );
}
