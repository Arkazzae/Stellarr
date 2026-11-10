"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons/Icon";
import { Popover, type PopoverTriggerProps } from "@/components/primitives/Popover";
import type { Sound } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

/** How long a tile keeps its `play` highlight after it is pressed. */
const FLASH_MS = 260;

export interface SoundboardGridProps {
  sounds: Sound[];
  onPlaySound: (soundId: string) => void;
  /** The local playback level, 0 to 100. */
  volume: number;
  onVolumeChange: (volume: number) => void;
  /** False renders the tiles disabled rather than hiding them. */
  supported?: boolean;
}

/**
 * The volume slider and the sound tiles, or the empty state when the server
 * has no sounds. The control bar's popover and its compact menu both show it.
 */
export function SoundboardGrid({
  sounds,
  onPlaySound,
  volume,
  onVolumeChange,
  supported = true,
}: SoundboardGridProps) {
  const { t } = useLanguage();
  const volumeId = useId();
  const [flashing, setFlashing] = useState<string | null>(null);

  useEffect(() => {
    if (flashing === null) return;
    const timer = window.setTimeout(() => setFlashing(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashing]);

  const play = (soundId: string) => {
    setFlashing(soundId);
    onPlaySound(soundId);
  };

  return (
    <>
      <div className="dp-volume">
        <div className="dp-volume-head">
          <label htmlFor={volumeId}>
            <Icon name="sound" size={14} />
            {t("voice.soundboardVolume")}
          </label>
          <output htmlFor={volumeId}>{volume}%</output>
        </div>
        <input
          id={volumeId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
      </div>
      {sounds.length === 0 ? (
        <div className="dp-board-empty" role="status" aria-label={t("voice.noSounds")}>
          <span className="dp-board-empty-icon" aria-hidden="true">
            <Icon name="wave" size={20} />
          </span>
          <b>{t("voice.noSoundsTitle")}</b>
          <span>{t("voice.noSoundsDetail")}</span>
        </div>
      ) : (
        <div className="dp-grid">
          {sounds.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className={flashing === sound.id ? "dp-snd play" : "dp-snd"}
              disabled={!supported}
              title={sound.name}
              onClick={() => play(sound.id)}
            >
              <b aria-hidden="true">{sound.glyph}</b>
              <span className="dp-snd-name">{sound.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export interface SoundboardPopoverProps extends SoundboardGridProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra panel classes, such as `vc-pop` in the control bar. */
  className?: string;
  renderTrigger: (props: PopoverTriggerProps) => ReactNode;
}

/** The soundboard as a panel that hangs off its trigger. */
export function SoundboardPopover({
  open,
  onOpenChange,
  className,
  renderTrigger,
  ...grid
}: SoundboardPopoverProps) {
  const { t } = useLanguage();

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      className={className ? `board ${className}` : "board"}
      renderTrigger={renderTrigger}
    >
      <div className="dp-cap">{t("voice.soundboard")}</div>
      <SoundboardGrid {...grid} />
    </Popover>
  );
}
