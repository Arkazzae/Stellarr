import type { InlineNode } from "./inline";
import type { MessagePart } from "./parts";

/**
 * What can leave a message: its words for the clipboard, or one of its files
 * for the disk. Both read the parsed parts rather than the DOM, so what comes
 * out is what was written.
 */

function plainNode(node: InlineNode): string {
  switch (node.kind) {
    case "emoji":
      return `:${node.shortcode}:`;
    case "link":
      return node.href;
    // Nobody typed the "(edytowano)" mark, so it is not part of the words.
    case "edited":
      return "";
    default:
      return node.text;
  }
}

/** The text parts of a message, one line each; pictures and files have no words. */
export function plainText(parts: readonly MessagePart[]): string {
  return parts
    .flatMap((part) => (part.kind === "text" ? [part.nodes.map(plainNode).join("")] : []))
    .filter((line) => line.length > 0)
    .join("\n");
}

export interface DownloadTarget {
  href: string;
  name: string;
  /** True for the kinds the clipboard can take as a bitmap. */
  image?: boolean;
}

/** A part without an address has nothing to save. */
function target(href: string | undefined, name: string, image = false): DownloadTarget | undefined {
  if (href === undefined || href.length === 0) return undefined;
  return image ? { href, name, image } : { href, name };
}

/** The file a part stands for; `media` picks the tile of a gallery. */
function partTarget(part: MessagePart, media: number): DownloadTarget | undefined {
  switch (part.kind) {
    case "image":
      return target(part.src, part.alt, true);
    case "gallery": {
      const image = part.images[media] ?? part.images[0];
      return image === undefined ? undefined : target(image.src, image.alt, true);
    }
    case "audio":
    case "file":
      return target(part.url, part.name);
    case "video":
      return target(part.url, part.name ?? "");
    default:
      return undefined;
  }
}

/** Where in a message the pointer was; indexes are absent when it was over neither. */
export interface PointedAt {
  part: number | null;
  media: number | null;
}

/** The file under the pointer, else the first one the message has. */
export function downloadTarget(
  parts: readonly MessagePart[],
  pointed: PointedAt,
): DownloadTarget | undefined {
  const under = pointed.part === null ? undefined : parts[pointed.part];
  const exact = under === undefined ? undefined : partTarget(under, pointed.media ?? 0);
  if (exact !== undefined) return exact;

  for (const part of parts) {
    const first = partTarget(part, 0);
    if (first !== undefined) return first;
  }
  return undefined;
}

/** Starts the download straight from the address, within the click that chose it. */
export function startDownload({ href, name }: DownloadTarget): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.append(link);
  link.click();
  link.remove();
}
