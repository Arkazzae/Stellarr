/**
 * What a rendered message body is made of: the union the transcript renders and
 * the callbacks its tiles raise. Pure types, so the modules that build parts and
 * the components that draw them share one vocabulary at no runtime cost.
 */

import type { CodeLanguageId, CodeToken } from "./codeLanguages";
import type { InlineNode } from "./inline";

export interface TextPart {
  kind: "text";
  nodes: InlineNode[];
}

export interface ImagePart {
  kind: "image";
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface GalleryPart {
  kind: "gallery";
  images: GalleryImage[];
}

export interface FilePart {
  kind: "file";
  name: string;
  /** Up to four characters, shown in the sheet-corner badge. */
  ext: string;
  /** Already formatted. */
  size: string;
  url?: string;
}

export interface AudioPart {
  kind: "audio";
  name: string;
  /** Composer recording, as opposed to an ordinary uploaded audio file. */
  voiceMessage?: boolean;
  /** Measured duration formatted as "0:19". */
  duration?: string;
  url?: string;
  /** 0..1 bar heights. Omitted means "decode the file and find out". */
  peaks?: number[];
  /**
   * Byte length, so the player can decide whether drawing a real waveform is
   * worth downloading and decoding the whole file up front.
   */
  size?: number;
}

export interface VideoPart {
  kind: "video";
  /** Poster frame generated from the uploaded file, when decoding succeeded. */
  thumb?: string;
  duration?: string;
  width?: number;
  height?: number;
  url?: string;
  name?: string;
}

export interface EmbedPart {
  kind: "embed";
  domain: string;
  title: string;
  description: string;
  url?: string;
  /** Preview image, already served from our own origin. */
  thumb?: string;
}

/**
 * A link with a player behind it.
 *
 * Separate from `EmbedPart` because it renders as a frame, not a card, and
 * because opening it loads a third party's player: a different decision from
 * showing a title and a picture, and one the reader makes for themselves.
 */
export interface VideoEmbedPart {
  kind: "video-embed";
  provider: string;
  providerId: string;
  url: string;
  domain: string;
  title?: string;
  description?: string;
  thumb?: string;
  startSeconds?: number;
}

/** A canonical GIPHY page; the client resolves its current media URL directly. */
export interface GiphyPart {
  kind: "giphy";
  id: string;
  pageUrl: string;
}

export interface CodePart {
  kind: "code";
  /** The authored fence info: a lexer alias, a filename, or an empty string. */
  lang: string;
  /** Raw source lets the reader change highlighting without changing content. */
  source?: string;
  /** Initially selected from the fence info (or conservatively detected). */
  language?: CodeLanguageId;
  tokens: CodeToken[];
}

export type MessagePart =
  | TextPart
  | ImagePart
  | GalleryPart
  | FilePart
  | AudioPart
  | VideoPart
  | EmbedPart
  | VideoEmbedPart
  | GiphyPart
  | CodePart;

/**
 * What an attachment can ask its host to do. One optional bag threaded down
 * from the transcript so every tile stays a pure renderer; an omitted handler
 * renders the affordance inert rather than hiding it, as the ports do for
 * actions that are not implemented.
 */
export interface AttachmentCallbacks {
  /**
   * Opens the lightbox. The whole run is passed, not just the clicked image,
   * because a gallery is browsed rather than inspected: the viewer needs the
   * neighbours to step through.
   */
  onOpenImage?(images: GalleryImage[], index: number): void;
  onDownloadFile?(part: FilePart): void;
  onPlayVideo?(part: VideoPart): void;
  onOpenEmbed?(part: EmbedPart): void;
  onCopyCode?(part: CodePart): void;
  /** Stable opaque id sent with GIPHY requests and action pingbacks. */
  giphyCustomerId?: string;
}
