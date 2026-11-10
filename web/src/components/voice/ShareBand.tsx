"use client";

import { useEffect, useId, useRef } from "react";

import { Icon } from "@/components/icons/Icon";
import type { ScreenShareVM } from "@/components/view-models";
import { useLanguage } from "@/state/LanguageProvider";

export interface ShareBandProps {
  share: ScreenShareVM;
  /** Opting in is what makes the container subscribe to the stream. */
  onWatch: () => void;
  onStopWatching: () => void;
  /** Your own screen: played back muted so you do not hear yourself twice. */
  local?: boolean;
  /** Local receiver-side level for the person sharing, from 0 to 200. */
  volume?: number;
  onVolumeChange?: (volume: number) => void;
}

/**
 * Someone's screen above the tiles.
 *
 * The caller renders the band only while a share exists, so a `<video>` can
 * never outlive the stream it was showing. Until the viewer opts in, the poster
 * (or a placeholder) sits behind a cover with the watch button.
 */
export function ShareBand({
  share,
  onWatch,
  onStopWatching,
  local = false,
  volume,
  onVolumeChange,
}: ShareBandProps) {
  const { t } = useLanguage();
  const video = useRef<HTMLVideoElement>(null);
  const volumeId = useId();

  // `srcObject` is a property, never an attribute; see ParticipantTile.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = share.stream;
    return () => {
      element.srcObject = null;
    };
  }, [share.stream]);

  const screenLabel = t("share.screenLabel", { name: share.ownerName });
  const unavailable = t("share.previewUnavailable");
  const hasPicture = share.stream !== null || Boolean(share.posterUrl);
  const covered = !local && !share.watching;

  return (
    <div className={share.watching ? "share-band show watching" : "share-band show"}>
      {share.stream ? (
        <video ref={video} autoPlay playsInline muted aria-label={screenLabel} />
      ) : share.posterUrl ? (
        <img src={share.posterUrl} alt={screenLabel} width={1200} height={500} />
      ) : (
        <div className="share-placeholder" role="status" aria-label={unavailable}>
          {/* Under the cover the note moves into it: centred behind the
              button, the two would sit on top of each other. */}
          {covered ? null : (
            <>
              <Icon name="screencast" size={22} />
              <span>{unavailable}</span>
            </>
          )}
        </div>
      )}

      {covered ? (
        <div className="watch-cover">
          <span className="wc-title">{t("share.screenBy", { name: share.ownerName })}</span>
          {hasPicture ? null : (
            <span className="wc-note" aria-hidden="true">
              {unavailable}
            </span>
          )}
          <button type="button" className="watch-btn" onClick={onWatch}>
            <Icon name="play" size={13} /> {t("share.watch")}
          </button>
        </div>
      ) : null}

      {local || !share.watching ? null : (
        <div className="share-toolbar">
          {volume === undefined || onVolumeChange === undefined ? null : (
            <div
              className="share-volume"
              role="group"
              aria-label={t("voice.participantVolume", { name: share.ownerName })}
            >
              <Icon name="speaker" size={15} />
              <label className="sr-only" htmlFor={volumeId}>
                {t("voice.participantVolume", { name: share.ownerName })}
              </label>
              <input
                id={volumeId}
                type="range"
                min={0}
                max={200}
                step={5}
                value={volume}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
              />
              <output htmlFor={volumeId}>{volume}%</output>
            </div>
          )}
          <button type="button" className="stop-watch" onClick={onStopWatching}>
            {t("share.stopWatching")}
          </button>
        </div>
      )}
    </div>
  );
}
