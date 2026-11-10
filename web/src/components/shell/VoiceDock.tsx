"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import type { CallVM } from "@/components/view-models";
import { SoundboardPopover } from "@/components/voice/SoundboardPopover";
import type { MessageKey } from "@/i18n";
import type { NoiseSuppressionMode, Sound } from "@/ports";
import { useLanguage } from "@/state/hooks";

interface NoiseStep {
  /** What one more press switches to; the five modes form a ring. */
  next: NoiseSuppressionMode;
  /** The same OFF, WEB, DSP, AI and AI+ marks as in voice settings. */
  icon: IconName;
  name: MessageKey;
}

const NOISE_STEPS: Record<NoiseSuppressionMode, NoiseStep> = {
  off: { next: "rnnoise", icon: "noiseOff", name: "shell.noiseSuppression.off" },
  rnnoise: { next: "gtcrn", icon: "noiseRnnoise", name: "shell.noiseSuppression.rnnoise" },
  gtcrn: { next: "speex", icon: "noiseGtcrn", name: "shell.noiseSuppression.gtcrn" },
  speex: { next: "browser", icon: "noiseSpeex", name: "shell.noiseSuppression.speex" },
  browser: { next: "off", icon: "noiseBrowser", name: "shell.noiseSuppression.classic" },
};

const HEADLINE: Record<CallVM["headline"], MessageKey> = {
  "requesting-mic": "shell.voiceRequestingMic",
  connecting: "shell.voiceConnecting",
  screen: "shell.voiceScreen",
  connected: "shell.voiceConnected",
  reconnecting: "shell.voiceReconnecting",
  degraded: "shell.voiceDegraded",
  failed: "shell.voiceFailed",
};

const QUALITY: Record<CallVM["connectionQuality"], MessageKey> = {
  unknown: "shell.voiceQualityMeasuring",
  good: "shell.voiceQualityGood",
  fair: "shell.voiceQualityFair",
  poor: "shell.voiceQualityPoor",
};

export interface VoiceDockProps {
  /** No call means the dock is present but `.hidden`, as in the mockup. */
  call: CallVM | null;
  sounds: Sound[];
  /** False renders the soundboard tiles disabled rather than hiding them. */
  soundboardSupported?: boolean;
  soundboardVolume: number;
  onChangeSoundboardVolume: (volume: number) => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  cameraSupported?: boolean;
  onToggleShare: () => void;
  noiseSuppression: NoiseSuppressionMode;
  onChangeNoiseSuppression: (mode: NoiseSuppressionMode) => void;
  onLeave: () => void;
  onPlaySound: (soundId: string) => void;
  /** Clicking the status row while something is live jumps back to the channel. */
  onReturnToChannel: () => void;
}

/**
 * Whole seconds since `startedAt`.
 *
 * It starts at 0 on the server render and on the first client pass and only
 * then follows the clock: reading `Date.now()` during render would differ
 * between the two and break hydration.
 */
function useElapsedSeconds(startedAt: number): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return seconds;
}

interface DockToggleProps {
  icon: IconName;
  iconSize?: number;
  pressed: boolean;
  /** `muted` for controls whose pressed state silences something, `on` for the rest. */
  pressedClass: "muted" | "on";
  title: string;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}

function DockToggle({
  icon,
  iconSize = 15,
  pressed,
  pressedClass,
  title,
  label,
  disabled,
  busy,
  onClick,
}: DockToggleProps) {
  return (
    <button
      type="button"
      className={pressed ? `dpill icon ${pressedClass}` : "dpill icon"}
      aria-pressed={pressed}
      title={title}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

type LiveDockProps = Omit<VoiceDockProps, "call"> & { call: CallVM };

function LiveDock({
  call,
  sounds,
  soundboardSupported = true,
  soundboardVolume,
  onChangeSoundboardVolume,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  cameraSupported = false,
  onToggleShare,
  noiseSuppression,
  onChangeNoiseSuppression,
  onLeave,
  onPlaySound,
  onReturnToChannel,
}: LiveDockProps) {
  const { t } = useLanguage();
  const [boardOpen, setBoardOpen] = useState(false);
  const seconds = useElapsedSeconds(call.startedAt);

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const latency = call.latencyMs === null ? null : Math.round(call.latencyMs);
  const quality = t(QUALITY[call.connectionQuality]);
  const qualitySummary =
    latency === null
      ? t("shell.voiceQualityMeasuringDetail")
      : t("shell.voiceQualityDetail", { quality, latency });

  const noise = NOISE_STEPS[noiseSuppression];
  const noiseLabel = t("shell.noiseSuppressionCycle", {
    current: t(noise.name),
    next: t(NOISE_STEPS[noise.next].name),
  });

  const cameraLabel = call.cameraPending
    ? t("voiceBar.cameraStarting")
    : call.cameraOn
      ? t("voiceBar.cameraStop")
      : t("voiceBar.cameraStart");

  // Something other than plain conversation is live, so the status row becomes
  // a way back to it rather than a label.
  const live = call.headline === "screen";

  const returnToChannel = (event: MouseEvent<HTMLElement>) => {
    // The trailing buttons sit inside the row; their clicks are their own.
    if (event.target instanceof Element && event.target.closest(".di-btn")) return;
    onReturnToChannel();
  };

  return (
    <div className="voice-dock" role="status">
      <div className="dock-card">
        <div
          className={live ? "dock-item clickable" : "dock-item"}
          title={live ? t("shell.returnToChannel") : undefined}
          // Only a control when it does something: a permanently focusable
          // status line would be a stop on the way to the buttons for nothing.
          role={live ? "button" : undefined}
          tabIndex={live ? 0 : undefined}
          onClick={live ? returnToChannel : undefined}
          onKeyDown={
            live
              ? (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onReturnToChannel();
                }
              : undefined
          }
        >
          <span className="di-txt">
            <b className={call.headline === "connected" ? "ok" : undefined}>
              <span>{t(HEADLINE[call.headline])}</span>
              {call.headline === "connected" ? (
                <span
                  className={`voice-connection-quality ${call.connectionQuality}`}
                  title={qualitySummary}
                  aria-label={qualitySummary}
                  aria-live="off"
                >
                  {quality}
                  {latency === null ? null : ` · ${latency} ms`}
                </span>
              ) : null}
            </b>
            <span className="di-where">
              <span className="di-channel">{call.channelName}</span>
              <i aria-hidden="true">·</i>
              <time dateTime={`PT${minutes}M${rest}S`}>
                {`${twoDigits(minutes)}:${twoDigits(rest)}`}
              </time>
            </span>
          </span>
          <button
            type="button"
            className={`di-btn noise ${noiseSuppression}`}
            title={noiseLabel}
            aria-label={noiseLabel}
            data-noise-mode={noiseSuppression}
            onClick={() => onChangeNoiseSuppression(noise.next)}
          >
            <Icon name={noise.icon} size={24} className={`noise-icon ${noiseSuppression}`} />
          </button>
          <button
            type="button"
            className="di-btn danger"
            title={t("voiceBar.disconnect")}
            aria-label={t("voiceBar.disconnect")}
            onClick={onLeave}
          >
            <Icon name="phoneX" size={15} />
          </button>
        </div>

        <div className="dock-sep" aria-hidden="true" />

        <div className="dock-row">
          <DockToggle
            icon={call.muted ? "micSlash" : "mic"}
            pressed={call.muted}
            pressedClass="muted"
            title={call.muted ? t("voiceBar.unmute") : t("voiceBar.mute")}
            label={t("voice.microphone")}
            onClick={onToggleMute}
          />
          <DockToggle
            icon="headphones"
            pressed={call.deafened}
            pressedClass="muted"
            title={call.deafened ? t("shell.unmuteSound") : t("shell.muteSound")}
            label={t("shell.muteSound")}
            onClick={onToggleDeafen}
          />
          <DockToggle
            icon="camera"
            pressed={call.cameraOn}
            pressedClass="on"
            title={cameraSupported ? cameraLabel : t("voiceBar.cameraUnsupported")}
            label={cameraLabel}
            busy={call.cameraPending}
            disabled={!cameraSupported || call.cameraPending}
            onClick={onToggleCamera}
          />
          <DockToggle
            icon="screencast"
            iconSize={17}
            pressed={call.sharing}
            pressedClass="on"
            title={call.sharing ? t("shell.stopSharing") : t("voiceBar.shareScreen")}
            label={t("voiceBar.shareScreen")}
            onClick={onToggleShare}
          />
          <SoundboardPopover
            sounds={sounds}
            open={boardOpen}
            onOpenChange={setBoardOpen}
            onPlaySound={onPlaySound}
            volume={soundboardVolume}
            onVolumeChange={onChangeSoundboardVolume}
            supported={soundboardSupported}
            renderTrigger={(trigger) => (
              <button
                type="button"
                className="dpill icon"
                title={t("voice.soundboard")}
                aria-label={t("voice.soundboard")}
                {...trigger}
              >
                <Icon name="board" size={15} />
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
}

/** The call in progress, above the account row: who you are with, and the controls. */
export function VoiceDock({ call, ...rest }: VoiceDockProps) {
  if (call === null) return <div className="voice-dock hidden" role="status" />;
  return <LiveDock call={call} {...rest} />;
}
