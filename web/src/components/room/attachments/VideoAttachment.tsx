"use client";

import { useState, type KeyboardEvent } from "react";

import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/LanguageProvider";

import type { VideoPart } from "../parts";

import { formatMediaTime } from "./mediaTime";

export interface VideoAttachmentProps {
  part: VideoPart;
  onPlay?(part: VideoPart): void;
}

/** The in-message tile of an uploaded video; playing it is the host's decision. */
export function VideoAttachment({ part, onPlay }: VideoAttachmentProps) {
  const { t } = useLanguage();
  const [measuredDuration, setMeasuredDuration] = useState<number | null>(null);
  const hasUrl = part.url !== undefined && part.url !== "";
  const play = onPlay !== undefined && part.url !== undefined ? () => onPlay(part) : undefined;
  const duration =
    part.duration ??
    (measuredDuration === null ? undefined : formatMediaTime(measuredDuration));

  // A button role comes with the keyboard contract of a button.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (play === undefined || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    play();
  };

  return (
    <div
      className="att att-video"
      role={play === undefined ? undefined : "button"}
      tabIndex={play === undefined ? undefined : 0}
      aria-label={
        duration === undefined
          ? t("attachment.playVideo")
          : t("attachment.playVideoDuration", { duration })
      }
      onClick={play}
      onKeyDown={onKeyDown}
    >
      {part.thumb !== undefined ? (
        <img src={part.thumb} alt="" width={part.width} height={part.height} loading="lazy" />
      ) : hasUrl ? (
        // Without a poster the first frame of the file itself is the preview.
        // The tile is opened, not played here, so the frame is silent without
        // muting the element: a browser that can play the preview natively,
        // such as a phone's inline player, must not lose its sound.
        <video
          src={part.url}
          preload="metadata"
          playsInline
          aria-hidden="true"
          onLoadedMetadata={(event) => {
            const reported = event.currentTarget.duration;
            if (Number.isFinite(reported)) setMeasuredDuration(reported);
          }}
        />
      ) : (
        <span className="video-placeholder" aria-hidden="true" />
      )}
      <span className="overlay-play">
        <span>
          <Icon name="play" size={16} />
        </span>
      </span>
      {duration === undefined ? null : <span className="vdur">{duration}</span>}
    </div>
  );
}
