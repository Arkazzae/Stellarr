/**
 * What the channel panel lists. The same collector accepts the live transcript
 * window and pages returned by the complete server-side channel index; stable
 * item ids let the room merge both without duplicates.
 */

import type { Message } from "@/ports";

import {
  toParts,
  type AudioPart,
  type FilePart,
  type ImagePart,
  type MessagePart,
  type VideoPart,
} from "./parts";
import type { TranscriptSectionVM } from "./transcriptRows";

/** Which list the panel is showing. Also which topbar button raised it. */
export type ChannelPanelTab = "search" | "pinned" | "media" | "links";

/**
 * One picture, clip, recording or file, with the block it came from.
 *
 * The part travels whole rather than flattened into a src and a name: opening
 * a video needs the poster and duration the tile already has, and the panel
 * hands the same object back to the callbacks the transcript uses.
 */
export interface MediaItemVM {
  /** Stable across rebuilds: the message's id plus the item's place inside it. */
  id: string;
  part: ImagePart | VideoPart | AudioPart | FilePart;
  authorName: string;
  /** ISO 8601, of the block the item was posted in. */
  timestamp: string;
}

export interface LinkItemVM {
  id: string;
  href: string;
  /** The unfurled title where the server produced one, the URL otherwise. */
  title: string;
  /** "youtube.com" — from the unfurl, or parsed off the URL. */
  domain: string;
  /** Preview image, present only when the link was unfurled. */
  thumb?: string;
  authorName: string;
  timestamp: string;
}

/**
 * One pinned message, as the panel lists it.
 *
 * A flattened row rather than the message itself: the panel shows one line per
 * pin and the transcript is where the whole thing lives, so carrying parts,
 * attachments and embeds in here would be carrying them nowhere.
 */
export interface PinnedMessageVM {
  id: string;
  authorId: string;
  authorName: string;
  /** One line of it, or a phrase naming what it carries when it has no words. */
  preview: string;
  /** ISO 8601, when it was said. */
  timestamp: string;
  /** ISO 8601, when it was pinned. The list is ordered by this, newest first. */
  pinnedAt: string;
}

export interface ChannelPanelData {
  media: MediaItemVM[];
  links: LinkItemVM[];
}

type Origin = Pick<MediaItemVM, "authorName" | "timestamp">;

/** "https://www.youtube.com/watch?v=x" → "youtube.com". */
function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    // Links are only ever linkified from http(s) URLs, so this is not expected;
    // the raw string still beats an empty domain if it happens.
    return href;
  }
}

/**
 * The media a part contributes. A gallery is a run of pictures collapsed for
 * the transcript; the panel lists pictures, so it comes back apart. Its images
 * are returned last to first because the whole list is reversed at the end,
 * and one posting's photographs should still read in the order they were
 * posted in. A GIF is deliberately not media: GIPHY's terms forbid storing or
 * proxying its files, so every tile would be a live request to a third party.
 */
function mediaOf(part: MessagePart, id: string, origin: Origin): MediaItemVM[] {
  switch (part.kind) {
    case "image":
    case "video":
    case "audio":
    case "file":
      return [{ id, part, ...origin }];
    case "gallery":
      return part.images
        .map((image, at) => ({
          id: `${id}:${at}`,
          part: { kind: "image" as const, src: image.src, alt: image.alt },
          ...origin,
        }))
        .reverse();
    default:
      return [];
  }
}

/** The links a part contributes: unfurled cards, and bare links in text. */
function linksOf(part: MessagePart, id: string, origin: Origin): LinkItemVM[] {
  switch (part.kind) {
    case "embed":
    case "video-embed": {
      const href = part.url;
      if (href === undefined || href.length === 0) return [];
      return [
        {
          id,
          href,
          title: part.title || href,
          domain: part.domain,
          ...(part.thumb === undefined ? {} : { thumb: part.thumb }),
          ...origin,
        },
      ];
    }
    case "text":
      return part.nodes.flatMap((node, at) =>
        node.kind === "link"
          ? [
              {
                id: `${id}:${at}`,
                href: node.href,
                title: node.href,
                domain: hostOf(node.href),
                ...origin,
              },
            ]
          : [],
      );
    default:
      return [];
  }
}

/** Newest wins: the list is already newest-first when this runs. */
function withoutRepeats(links: LinkItemVM[]): LinkItemVM[] {
  const seen = new Set<string>();
  return links.filter(({ href }) => {
    if (seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}

/**
 * Walks the transcript once and sorts what it finds into the panel's lists,
 * newest first: someone opening the panel is looking for the picture from ten
 * minutes ago far more often than for the one from March. A fenced code block
 * is a paste rather than an uploaded file, so it appears in neither list.
 */
export function collectPanelItems(
  sections: readonly TranscriptSectionVM[],
): ChannelPanelData {
  const media: MediaItemVM[] = [];
  const links: LinkItemVM[] = [];

  for (const { groups } of sections) {
    for (const group of groups) {
      // A server notice is chrome, not something a person shared.
      if (group.system === true) continue;
      const origin = { authorName: group.authorName, timestamp: group.timestamp };
      for (const body of group.bodies) {
        body.parts.forEach((part, index) => {
          const id = `${body.id}:${index}`;
          media.push(...mediaOf(part, id, origin));
          links.push(...linksOf(part, id, origin));
        });
      }
    }
  }

  return { media: media.reverse(), links: withoutRepeats(links.reverse()) };
}

/**
 * Builds panel items from server-indexed messages rather than the transcript
 * window. Sorting oldest first before collecting gives the same newest-first
 * output as the transcript, and keeps the order of images inside a gallery.
 */
export function collectIndexedPanelItems(
  messages: readonly Message[],
): ChannelPanelData {
  const groups = [...messages]
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((message) => ({
      id: message.id,
      authorId: message.author.id,
      authorName: message.author.displayName,
      ...(message.author.id === "system" ? { system: true } : {}),
      timestamp: message.createdAt,
      bodies: [{ id: message.id, parts: toParts(message) }],
    }));
  return collectPanelItems([{ day: "", groups }]);
}
