"use client";

import { useEffect, useRef, useState } from "react";

import {
  fetchGiphyGif,
  resolveGiphyApiKey,
  trackGiphyAction,
  type GiphyGif,
} from "@/lib/giphy";
import { useLanguage } from "@/state/LanguageProvider";

import type { GalleryImage, GiphyPart } from "../parts";

export interface GiphyAttachmentProps {
  part: GiphyPart;
  /** Stable opaque id sent with GIPHY requests and action pingbacks. */
  customerId: string;
  onOpen?(images: GalleryImage[], index: number): void;
}

/** What was learned about one GIF id; `gif` is null when it could not be had. */
interface Outcome {
  id: string;
  gif: GiphyGif | null;
}

const REL = "ugc nofollow noopener noreferrer";

export function GiphyAttachment({ part, customerId, onOpen }: GiphyAttachmentProps) {
  const { t } = useLanguage();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const viewReported = useRef<string | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY ?? "";

  useEffect(() => {
    const controller = new AbortController();
    resolveGiphyApiKey(apiKey)
      .then((key) => fetchGiphyGif(key, part.id, customerId, controller.signal))
      .then((gif) => setOutcome({ id: part.id, gif }))
      .catch(() => {
        if (!controller.signal.aborted) setOutcome({ id: part.id, gif: null });
      });
    return () => controller.abort();
  }, [apiKey, customerId, part.id]);

  // An outcome for a previous id says nothing about this one.
  const current = outcome?.id === part.id ? outcome : null;

  if (current !== null && current.gif === null) {
    return (
      <div className="att att-giphy-fallback">
        <span>{t("attachment.gifUnavailable")}</span>
        <a href={part.pageUrl} target="_blank" rel={REL}>
          {t("attachment.openGiphy")}
        </a>
      </div>
    );
  }

  if (current === null || current.gif === null) {
    return (
      <div className="att att-giphy-loading" role="status">
        <span className="sr-only">{t("attachment.loadingGif")}</span>
      </div>
    );
  }

  const { gif } = current;
  const media = (
    <picture>
      {gif.stillUrl === undefined ? null : (
        <source media="(prefers-reduced-motion: reduce)" srcSet={gif.stillUrl} />
      )}
      <img
        src={gif.mediaUrl}
        alt={gif.alt}
        width={gif.width}
        height={gif.height}
        loading="lazy"
        onError={() => setOutcome({ id: part.id, gif: null })}
        onLoad={() => {
          // GIPHY counts one view per GIF, not one per load event.
          if (viewReported.current === gif.id) return;
          viewReported.current = gif.id;
          void trackGiphyAction(gif.analytics.onload, customerId);
        }}
      />
    </picture>
  );

  return (
    <figure className="att att-giphy">
      {onOpen === undefined ? (
        media
      ) : (
        <button
          type="button"
          className="att-giphy-media"
          aria-label={t("attachment.zoomGif", { alt: gif.alt })}
          onClick={() => onOpen([{ src: gif.mediaUrl, alt: gif.alt }], 0)}
        >
          {media}
        </button>
      )}
      <figcaption>
        <a href={gif.pageUrl} target="_blank" rel={REL}>
          {gif.username === undefined ? "GIPHY" : t("attachment.giphyBy", { name: gif.username })}
        </a>
      </figcaption>
    </figure>
  );
}
