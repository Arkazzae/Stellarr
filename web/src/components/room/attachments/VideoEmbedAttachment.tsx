"use client";

import { useState, type KeyboardEvent } from "react";

import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/LanguageProvider";

import type { VideoEmbedPart } from "../parts";

import { playerSource, providerLabel } from "./players";
import { ProviderPlayerFrame } from "./ProviderPlayerFrame";

export interface VideoEmbedAttachmentProps {
  part: VideoEmbedPart;
}

function VideoMetadata({ part }: { part: VideoEmbedPart }) {
  return (
    <div className="ve-meta">
      <span className="dom">{part.domain}</span>
      {part.title === undefined ? null : <b>{part.title}</b>}
      {part.description === undefined ? null : <p>{part.description}</p>}
    </div>
  );
}

/**
 * The tile a video link becomes.
 *
 * A facade, not a player: it draws the title, description and poster the server
 * already holds, all from our own origin, and asks the video host for nothing.
 * The player replaces it, inside the same message, only after a click.
 */
export function VideoEmbedAttachment({ part }: VideoEmbedAttachmentProps) {
  const { t } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const label = providerLabel(part.provider);
  const source = playerSource({
    provider: part.provider,
    providerId: part.providerId,
    ...(part.startSeconds === undefined ? {} : { startSeconds: part.startSeconds }),
  });
  const play = source.supported ? () => setPlaying(true) : undefined;

  if (playing && source.supported) {
    return (
      <div className="att att-vembed playing">
        <div className="ve-stage">
          <ProviderPlayerFrame className="ve-frame" src={source.url} title={part.title ?? label} />
        </div>
        <VideoMetadata part={part} />
      </div>
    );
  }

  // Without a provider thumbnail there is nothing honest to draw as a poster,
  // so the recognised provider is shown as a compact link with a play action.
  if (part.thumb === undefined) {
    return (
      <div className="att att-vembed compact">
        <div className="ve-meta">
          <span className="dom">{part.domain}</span>
          {part.title === undefined ? null : <b>{part.title}</b>}
          {play === undefined ? null : (
            <button type="button" className="ve-play-inline" onClick={play}>
              <Icon name="play" size={14} />
              {t("attachment.playIn", { label })}
            </button>
          )}
        </div>
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (play === undefined || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    play();
  };

  return (
    <div className="att att-vembed">
      <div
        className="ve-stage"
        role="button"
        tabIndex={0}
        aria-label={
          part.title === undefined
            ? t("attachment.playMaterial", { label })
            : t("attachment.playVideoProvider", { title: part.title, label })
        }
        onClick={play}
        onKeyDown={onKeyDown}
      >
        <img src={part.thumb} alt="" loading="lazy" />
        <span className="overlay-play">
          <span>
            <Icon name="play" size={18} />
          </span>
        </span>
        <span className="ve-badge">{label}</span>
      </div>
      <VideoMetadata part={part} />
    </div>
  );
}
