"use client";

import type { AttachmentCallbacks, MessagePart } from "../parts";

import { AudioAttachment } from "./AudioAttachment";
import { CodeAttachment } from "./CodeAttachment";
import { EmbedAttachment } from "./EmbedAttachment";
import { FileAttachment } from "./FileAttachment";
import { GiphyAttachment } from "./GiphyAttachment";
import { ImageAttachment } from "./ImageAttachment";
import {
  TranslatedTextAttachment,
  type MessageTranslationOptions,
} from "./TranslatedTextAttachment";
import { VideoAttachment } from "./VideoAttachment";
import { VideoEmbedAttachment } from "./VideoEmbedAttachment";

/** Sent with GIPHY requests when the host supplies no customer id of its own. */
const DEFAULT_GIPHY_CUSTOMER_ID = "stellarr";

export interface AttachmentProps {
  part: MessagePart;
  callbacks?: AttachmentCallbacks;
  /** New messages jump ahead of older visible rows in the translation queue. */
  priority?: boolean;
  translation?: MessageTranslationOptions;
}

/** One message part. The `.msg-body` wrapper belongs to `MessageGroup`. */
export function Attachment({ part, callbacks = {}, priority = false, translation }: AttachmentProps) {
  switch (part.kind) {
    case "text":
      return (
        <TranslatedTextAttachment nodes={part.nodes} priority={priority} translation={translation} />
      );
    case "image":
    case "gallery":
      return <ImageAttachment part={part} onOpen={callbacks.onOpenImage} />;
    case "file":
      return <FileAttachment part={part} onDownload={callbacks.onDownloadFile} />;
    case "audio":
      return <AudioAttachment part={part} />;
    case "video":
      return <VideoAttachment part={part} onPlay={callbacks.onPlayVideo} />;
    case "embed":
      return <EmbedAttachment part={part} onOpen={callbacks.onOpenEmbed} />;
    case "video-embed":
      return <VideoEmbedAttachment part={part} />;
    case "giphy":
      return (
        <GiphyAttachment
          part={part}
          customerId={callbacks.giphyCustomerId ?? DEFAULT_GIPHY_CUSTOMER_ID}
          onOpen={callbacks.onOpenImage}
        />
      );
    case "code":
      return <CodeAttachment part={part} onCopy={callbacks.onCopyCode} />;
  }
}
