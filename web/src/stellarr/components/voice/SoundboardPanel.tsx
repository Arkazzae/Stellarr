import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Icon } from "@stellarr/icons";
import type { Sound, SoundboardLive, SoundboardPlay } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

/** From this many sounds the panel offers a search. */
const SEARCH_FROM = 13;

export interface SoundboardPanelProps {
  sounds: readonly Sound[];
  /** What is playing in the room, and this person's cooldown. */
  live: SoundboardLive;
  /** False where the server leaves playing to moderation: the pads are locked and a line says so. */
  canPlay: boolean;
  /** The local playback level, 0 to 100. */
  volume: number;
  onVolumeChange: (volume: number) => void;
  onPlaySound: (soundId: string) => void;
  /** For people who manage the server: its settings, on the soundboard. */
  onManage?: () => void;
  /**
   * What stands at the start of the head instead of the panel's title, as the
   * phone menu's back button and title do. The countdown and the volume
   * toggle stay at its end.
   */
  lead?: ReactNode;
}

/** "Następny za 3 s" while your own cooldown runs. It alone re-renders each second. */
function Countdown({ live }: { live: SoundboardLive }) {
  const { t } = useLanguage();
  const seconds = useSyncExternalStore(live.subscribe, live.cooldownSeconds, live.cooldownSeconds);
  if (seconds === 0) return null;
  return <span className="sb-meta">{t("voice.soundboardNext", { seconds })}</span>;
}

/**
 * The fill that runs across a playing pad for the length of the clip. It is
 * placed against the moment the room started hearing it, so a panel opened
 * part-way through shows the clip part-way through.
 */
function PadFill({ play }: { play: SoundboardPlay }) {
  const fill = useRef<HTMLSpanElement>(null);
  const { startsAt, endsAt } = play;

  useLayoutEffect(() => {
    const node = fill.current;
    if (node === null || typeof node.animate !== "function") return;
    const animation = node.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: Math.max(1, endsAt - startsAt),
      easing: "linear",
      fill: "both",
    });
    animation.currentTime = Date.now() - startsAt;
    return () => animation.cancel();
  }, [startsAt, endsAt]);

  return <span ref={fill} className="sb-fill" aria-hidden="true" />;
}

interface PadsProps {
  sounds: readonly Sound[];
  live: SoundboardLive;
  locked: boolean;
  onPlaySound: (soundId: string) => void;
}

/** Two columns of pads. Only these re-render when a clip starts or ends somewhere in the room. */
function Pads({ sounds, live, locked, onPlaySound }: PadsProps) {
  const playing = useSyncExternalStore(live.subscribe, live.playing, live.playing);
  const cooling = useSyncExternalStore(
    live.subscribe,
    () => live.cooldownSeconds() > 0,
    () => false,
  );
  // The latest press of each sound is the one its pad follows.
  const bySound = new Map(playing.map((play) => [play.sound.id, play]));
  const disabled = locked || cooling;

  return (
    <div className="sb-grid">
      {sounds.map((sound) => {
        const play = bySound.get(sound.id);
        return (
          <button
            key={sound.id}
            type="button"
            className={play === undefined ? "sb-pad" : "sb-pad playing"}
            // Disabled for the pointer, not for focus: a cooldown that starts
            // under the keyboard must not throw focus out of the panel.
            aria-disabled={disabled || undefined}
            title={sound.name}
            onClick={() => {
              if (!disabled) onPlaySound(sound.id);
            }}
          >
            {play === undefined ? null : <PadFill key={play.playbackId} play={play} />}
            <span className="sb-glyph" aria-hidden="true">
              {sound.glyph}
            </span>
            <span className="sb-name">{sound.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The soundboard of a call: its head with the cooldown and the volume, a
 * search on a long board, the pads, and for those who manage the server the
 * way to its sounds. The dock, the call's bar and the phone's menu all show
 * this one panel.
 */
export function SoundboardPanel({
  sounds,
  live,
  canPlay,
  volume,
  onVolumeChange,
  onPlaySound,
  onManage,
  lead,
}: SoundboardPanelProps) {
  const { t } = useLanguage();
  const volumeId = useId();
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLocaleLowerCase();
  const shown =
    needle === "" ? sounds : sounds.filter((sound) => sound.name.toLocaleLowerCase().includes(needle));
  const empty = sounds.length === 0;

  return (
    <div className="sb-panel">
      <div className="sb-head">
        {lead ?? <b className="sb-title">{t("voice.soundboard")}</b>}
        <span className="sb-head-end">
          <Countdown live={live} />
          <button
            type="button"
            className="sb-head-btn"
            aria-label={t("voice.soundboardVolume")}
            title={t("voice.soundboardVolume")}
            aria-expanded={volumeOpen}
            aria-controls={volumeOpen ? volumeId : undefined}
            onClick={() => setVolumeOpen((open) => !open)}
          >
            <Icon name="speaker" size={16} />
          </button>
        </span>
      </div>

      {volumeOpen ? (
        <div className="sb-volume" id={volumeId}>
          <Icon name="speaker" size={14} />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            aria-label={t("voice.soundboardVolume")}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
          />
          <output>{volume}%</output>
        </div>
      ) : null}

      {sounds.length >= SEARCH_FROM ? (
        <label className="sb-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            placeholder={t("voice.soundboardSearch")}
            aria-label={t("voice.soundboardSearch")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}

      {/* Only with pads to lock: a board still loading says nothing it does not know. */}
      {!canPlay && !empty ? <p className="sb-note">{t("voice.soundboardLocked")}</p> : null}

      {empty ? (
        <p className="sb-empty">{t("voice.soundboardEmpty")}</p>
      ) : shown.length === 0 ? (
        <p className="sb-empty">{t("voice.soundboardNoMatch")}</p>
      ) : (
        <Pads sounds={shown} live={live} locked={!canPlay} onPlaySound={onPlaySound} />
      )}

      {onManage === undefined ? null : (
        <>
          <div className="sb-sep" aria-hidden="true" />
          <button type="button" className="sb-row" onClick={onManage}>
            <Icon name={empty ? "plus" : "sliders"} size={16} />
            <span>{empty ? t("settings.addSound") : t("voice.manageSounds")}</span>
          </button>
        </>
      )}
    </div>
  );
}
