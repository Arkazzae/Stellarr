"use client";

import { useCallback, useMemo, useState } from "react";

import type { ViewerTarget } from "@/components/room/MediaViewer";
import type { AttachmentCallbacks } from "@/components/room/parts";

/**
 * What the lightbox shows, and the callbacks that let any attachment tile in
 * the room open it. The state is the room's own: nothing else in the app opens
 * the lightbox, so it does not go through the UI provider.
 */
export function useAttachmentViewer(giphyCustomerId: string) {
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const close = useCallback(() => setTarget(null), []);

  const attachments = useMemo<AttachmentCallbacks>(
    () => ({
      giphyCustomerId,
      onOpenImage: (images, index) => setTarget({ kind: "image", images, index }),
      onPlayVideo: (part) =>
        setTarget({
          kind: "video",
          src: part.url ?? "",
          ...(part.thumb === undefined ? {} : { poster: part.thumb }),
          ...(part.name === undefined ? {} : { name: part.name }),
        }),
      // An embed card and a file are links, and links open where links open;
      // neither is worth a modal.
      onOpenEmbed: (part) => {
        if (part.url !== undefined) window.open(part.url, "_blank", "noopener");
      },
      onDownloadFile: (part) => {
        if (part.url !== undefined && part.url !== "") {
          window.open(part.url, "_blank", "noopener");
        }
      },
    }),
    [giphyCustomerId],
  );

  return { target, close, attachments };
}
