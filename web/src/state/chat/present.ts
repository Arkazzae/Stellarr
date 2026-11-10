import type { PinnedMessageVM } from "@/components/room/channelPanelModel";
import { toParts, type MentionTarget } from "@/components/room/parts";
import type { TranscriptSectionVM } from "@/components/room/Transcript";
import type { InterfaceLocale } from "@/i18n";
import { messageReference, type TranscriptSection } from "@/lib/format";
import type { Message, Reaction, Server, User } from "@/ports";

/** The one author id the transcript renders as a server notice. */
export const SYSTEM_AUTHOR_ID = "system";

/** Everything outside the messages that decides how a transcript reads. */
export interface PresentationContext {
  /** Whose blocks get the owner's tools; undefined while nobody is signed in. */
  selfId: string | undefined;
  server: Pick<Server, "name" | "iconUrl">;
  /** Author id to picture. A message carries a name, never a face. */
  faces: ReadonlyMap<string, string>;
  customEmoji: ReadonlyMap<string, string>;
  mentions: ReadonlyMap<string, MentionTarget>;
  pinnedIds: ReadonlySet<string>;
  reactionsOf: (messageId: string) => Reaction[];
  /** The badge of a file with no extension, in the reader's language. */
  extFallback: string;
}

/**
 * Turns grouped messages into what the transcript draws.
 *
 * A message carries an id and a name for its author, so the directory-side
 * facts (pictures, who you are, which messages are pinned) are merged in here
 * and the components stay presentational.
 */
export function presentTranscript(
  transcript: readonly TranscriptSection[],
  context: PresentationContext,
): TranscriptSectionVM[] {
  const { selfId, server, faces, customEmoji, mentions, pinnedIds, reactionsOf, extFallback } =
    context;
  return transcript.map((section) => ({
    day: section.day,
    groups: section.groups.map((group) => {
      const system = group.authorId === SYSTEM_AUTHOR_ID;
      const face = system ? server.iconUrl : faces.get(group.authorId);
      // A reply always starts its own block, so the head message is the one
      // that answers something.
      const answered = group.messages[0]?.replyTo;
      return {
        id: group.key,
        ...(answered === undefined || answered === null ? {} : { replyTo: answered }),
        authorId: group.authorId,
        authorName: system ? server.name : group.authorName,
        ...(selfId !== undefined && group.authorId === selfId ? { own: true } : {}),
        ...(face === undefined ? {} : { authorAvatarUrl: face }),
        ...(system ? { system: true } : {}),
        timestamp: group.startedAt,
        // One entry per message: a block can hold several, and each of them is
        // separately editable and deletable.
        bodies: group.messages.map((message) => {
          const reactions = reactionsOf(message.id);
          return {
            id: message.id,
            parts: toParts(message, {
              ...(system ? { system: true } : {}),
              emoji: customEmoji,
              mentions,
              extFallback,
            }),
            ...(pinnedIds.has(message.id) ? { pinned: true } : {}),
            ...(reactions.length > 0 ? { reactions } : {}),
          };
        }),
      };
    }),
  }));
}

/** Member id to picture, for the members that have one. */
export function memberFaces(members: readonly User[]): Map<string, string> {
  const faces = new Map<string, string>();
  for (const member of members) {
    if (member.avatarUrl !== undefined) faces.set(member.id, member.avatarUrl);
  }
  return faces;
}

/** Lower-cased username to the member an `@name` resolves to. */
export function mentionTargets(
  members: readonly User[],
  selfId: string | undefined,
): Map<string, MentionTarget> {
  return new Map(
    members.map((member) => [
      member.username.toLocaleLowerCase(),
      {
        userId: member.id,
        username: member.username,
        displayName: member.displayName,
        self: member.id === selfId,
      },
    ]),
  );
}

/** The pinned list's rows, in the order the messages were given. */
export function pinnedRows(
  pinned: readonly Message[],
  locale: InterfaceLocale,
  serverName: string,
): PinnedMessageVM[] {
  return pinned.flatMap((message) => {
    // Only ever absent if a server lists a message it does not consider
    // pinned. Dropping it beats dating a row with the epoch.
    if (message.pinnedAt === undefined) return [];
    const { authorName, preview } = messageReference(message, locale);
    const system = message.author.id === SYSTEM_AUTHOR_ID;
    return [{
      id: message.id,
      authorId: message.author.id,
      authorName: system ? serverName : authorName,
      preview,
      timestamp: message.createdAt,
      pinnedAt: message.pinnedAt,
    }];
  });
}
