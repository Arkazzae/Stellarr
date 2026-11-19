import { useState, type MouseEvent } from "react";

import { Icon, type IconName } from "@stellarr/icons";
import { ProgressRing } from "@/components/primitives/ProgressRing";
import type { CallVM } from "@/components/view-models";
import { SoundboardPopover } from "@/components/voice/SoundboardPopover";
import type { MessageKey } from "@/i18n";
import type { NoiseSuppressionMode, Sound, SoundboardLive, SuppressorDownload } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { CallClock } from "./CallClock";
import { IDLE_SOUNDBOARD } from "./soundboardLive";

interface NoiseStep {
  /** What one more press switches to; the five modes form a ring. */
  next: NoiseSuppressionMode;
  /** The OFF, WEB, DSP, AI and AI+ marks of the icon set. */
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

/** What the dock and the call view call each state of a call. */
export const CALL_HEADLINE: Record<CallVM["headline"], MessageKey> = {
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
  /**
   * A private call the other person has not joined yet. Once connected, the
   * dock says it is calling them, and keeps no time: nothing has started.
   */
  ringing?: boolean;
  sounds: Sound[];
  /** False where this person may not play the board: its pads are locked and it says why. */
  soundboardSupported?: boolean;
  /** What plays in the room and the cooldown, read by the soundboard panel alone. */
  soundboardLive?: SoundboardLive;
  /** For people who manage the server: its settings, on the soundboard. */
  onManageSounds?: () => void;
  soundboardVolume: number;
  onChangeSoundboardVolume: (volume: number) => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  cameraSupported?: boolean;
  onToggleShare: () => void;
  noiseSuppression: NoiseSuppressionMode;
  /**
   * An engine's files on their way. Drawn on the noise button only while it
   * is the engine the button shows, so pressing on past it hides the ring.
   */
  noiseDownload?: SuppressorDownload | null;
  onChangeNoiseSuppression: (mode: NoiseSuppressionMode) => void;
  onLeave: () => void;
  /** Absent where the call has no soundboard, which is a private one: the dock then has no trigger. */
  onPlaySound?: (soundId: string) => void;
  /** Clicking the status row while something is live jumps back to the channel. */
  onReturnToChannel: () => void;
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

type LiveDockProps = Omit<VoiceDockProps, "call"> & { call: CallVM };

function LiveDock({
  call,
  ringing = false,
  sounds,
  soundboardSupported = true,
  soundboardLive = IDLE_SOUNDBOARD,
  onManageSounds,
  soundboardVolume,
  onChangeSoundboardVolume,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  cameraSupported = false,
  onToggleShare,
  noiseSuppression,
  noiseDownload = null,
  onChangeNoiseSuppression,
  onLeave,
  onPlaySound,
  onReturnToChannel,
}: LiveDockProps) {
  const { t } = useLanguage();
  const [boardOpen, setBoardOpen] = useState(false);

  const connected = call.headline === "connected" && !ringing;
  const headline: MessageKey =
    ringing && call.headline === "connected" ? "shell.voiceRinging" : CALL_HEADLINE[call.headline];
  const latency = call.latencyMs === null ? null : Math.round(call.latencyMs);
  const quality = t(QUALITY[call.connectionQuality]);
  const qualitySummary =
    latency === null
      ? t("shell.voiceQualityMeasuringDetail")
      : t("shell.voiceQualityDetail", { quality, latency });

  const noise = NOISE_STEPS[noiseSuppression];
  const download = noiseDownload?.kind === noiseSuppression ? noiseDownload : null;
  const noiseNames = { current: t(noise.name), next: t(NOISE_STEPS[noise.next].name) };
  const noiseLabel =
    download === null
      ? t("shell.noiseSuppressionCycle", noiseNames)
      : download.percent === null
        ? t("shell.noiseSuppressionDownloadingUnknown", noiseNames)
        : t("shell.noiseSuppressionDownloading", { ...noiseNames, percent: download.percent });

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
            <b className={connected ? "ok" : undefined}>
              <span>{t(headline)}</span>
              {connected ? (
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
              {ringing ? null : (
                <>
                  <i aria-hidden="true">·</i>
                  <CallClock since={call.startedAt} />
                </>
              )}
            </span>
          </span>
          <button
            type="button"
            className={`di-btn noise ${noiseSuppression}${download ? " downloading" : ""}`}
            title={noiseLabel}
            aria-label={noiseLabel}
            aria-busy={download ? true : undefined}
            data-noise-mode={noiseSuppression}
            onClick={() => onChangeNoiseSuppression(noise.next)}
          >
            {download ? <ProgressRing percent={download.percent} size={28} /> : null}
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
          {onPlaySound === undefined ? null : (
            <SoundboardPopover
              sounds={sounds}
              live={soundboardLive}
              canPlay={soundboardSupported}
              open={boardOpen}
              onOpenChange={setBoardOpen}
              onPlaySound={onPlaySound}
              onManage={onManageSounds}
              volume={soundboardVolume}
              onVolumeChange={onChangeSoundboardVolume}
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
          )}
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
