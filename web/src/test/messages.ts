import type { Message } from "@/ports";

/** A timestamp `minute` minutes into a fixed hour, so ordering is easy to read. */
export function at(minute: number): string {
  return new Date(Date.UTC(2026, 0, 1, 12, minute)).toISOString();
}

/** A channel message by Ada with every optional field absent. */
export function message(
  id: string,
  minute: number,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    channelId: "ch-general",
    author: { id: "u-ada", displayName: "Ada" },
    content: `content of ${id}`,
    attachments: [],
    embeds: [],
    createdAt: at(minute),
    ...overrides,
  };
}
