"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import type { OpenVoiceMessageCapture } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { formatMediaTime } from "./attachments/mediaTime";
import { useAudioPeaks } from "./attachments/peaks";
import { useVoiceCapture } from "./useVoiceCapture";
import { BAR_COUNT, MAX_VOICE_MESSAGE_SECONDS } from "./voiceRecording";

export { BAR_COUNT, MAX_VOICE_MESSAGE_SECONDS };

/**
 * How close to the cap the countdown starts.
 *
 * The ten-minute ceiling is irrelevant for the entire minute you actually
 * spend recording, so it is not shown until it is about to cost you something.
 */
const LIMIT_WARNING_SECONDS = 30;

export interface VoiceRecorderProps {
  openMicrophone: OpenVoiceMessageCapture;
  /** The recorder is finished with: cancelled, deleted, or sent. */
  onCancel(): void;
  onSend(file: File, durationSeconds: number): Promise<void>;
}

/**
 * The in-composer lifecycle for one voice note: record, listen back, send.
 *
 * The live bars are measured from the microphone. Once recording stops they
 * are replaced by the waveform of the finished file, decoded the way the
 * transcript decodes a received one, so the preview is the message rather than
 * a picture of its tail end. Motion never pretends that sound exists.
 */
export function VoiceRecorder({ openMicrophone, onCancel, onSend }: VoiceRecorderProps) {
  const { t } = useLanguage();
  const capture = useVoiceCapture(openMicrophone, t);
  const { phase, ready, elapsed, levels } = capture;
  const [sending, setSending] = useState(false);
  // What went wrong after the recording succeeded; capture errors are the hook's.
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const player = useRef<HTMLAudioElement | null>(null);

  /*
   * The waveform of the finished recording. Null until it is decoded, and for
   * a file this browser cannot decode, in which case the frozen live tail
   * stays on screen: a true picture of the last seconds rather than a gap.
   */
  const recorded = useAudioPeaks(ready?.url, ready !== null, BAR_COUNT);

  const cancel = () => {
    capture.discard();
    onCancel();
  };

  const cancelOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    cancel();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => cancelOnEscape(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const send = async () => {
    if (ready === null || sending) return;
    setNotice(null);
    setSending(true);
    try {
      await onSend(ready.file, ready.durationSeconds);
      onCancel();
    } catch {
      setNotice(t("recorder.sendFailed"));
      setSending(false);
    }
  };

  const togglePreview = async () => {
    const audio = player.current;
    if (audio === null) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
      setNotice(t("recorder.previewFailed"));
    }
  };

  const reviewing = phase === "preview";
  const bars = reviewing ? (recorded ?? levels) : levels;
  /*
   * Which of the two waveforms is on screen, for the CSS. "file" is the whole
   * recording and spans the row; "live" is a tape of the last samples,
   * right-aligned and growing leftwards. The frozen fallback is still a tape,
   * so this follows what the bars are rather than the phase.
   */
  const waveKind = reviewing && recorded !== null ? "file" : "live";
  const duration = ready?.durationSeconds ?? 0;
  const played = reviewing && duration > 0 ? Math.round((playhead / duration) * bars.length) : 0;

  const remaining = MAX_VOICE_MESSAGE_SECONDS - elapsed;
  const nearLimit = phase === "recording" && remaining <= LIMIT_WARNING_SECONDS;
  // The number under the waveform describes the bar the cursor is on: the
  // playhead while it moves, the whole length otherwise.
  const clock = reviewing ? (playing ? playhead : duration) : elapsed;

  const status = sending
    ? t("recorder.sending")
    : phase === "requesting"
      ? t("voice.opening")
      : phase === "recording"
        ? nearLimit
          ? t("recorder.remaining", { time: formatMediaTime(remaining) })
          : t("voice.recording")
        : phase === "preview"
          ? t("voice.recordingReady")
          : t("recorder.unavailable");
  const message = notice ?? capture.error;

  return (
    <div
      className="voice-recorder"
      data-phase={sending ? "sending" : phase}
      data-wave={waveKind}
      aria-label={t("recorder.voiceMessage")}
    >
      <button
        type="button"
        className="voice-rec-cancel"
        aria-label={ready === null ? t("recorder.cancelVoiceMessage") : t("recorder.deleteRecording")}
        title={ready === null ? t("common.cancel") : t("recorder.deleteRecording")}
        onClick={cancel}
      >
        <Icon name={ready === null ? "x" : "trash"} size={17} />
      </button>

      {ready === null ? null : (
        <audio
          ref={player}
          src={ready.url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
          onEnded={() => {
            setPlaying(false);
            setPlayhead(0);
          }}
        />
      )}

      {reviewing ? (
        <button
          type="button"
          className="voice-rec-play"
          aria-label={playing ? t("recorder.pausePreview") : t("recorder.playPreview")}
          disabled={sending}
          onClick={() => void togglePreview()}
        >
          <Icon name={playing ? "pause" : "play"} size={13} />
        </button>
      ) : null}

      <div className="voice-rec-main">
        {/* A still red dot and the phase in words: neither relies on colour
            alone, and the only thing in this row that moves is the microphone. */}
        <div className="voice-rec-status" role="status" aria-live="polite">
          {phase === "recording" ? <i className="voice-rec-live" aria-hidden="true" /> : null}
          <span>{status}</span>
        </div>

        <div className="wave voice-rec-wave" aria-hidden="true">
          {bars.map((level, index) => (
            <i
              key={index}
              className={index < played ? "done" : undefined}
              style={{ height: `${3 + Math.round(level * 19)}px` }}
            />
          ))}
        </div>
      </div>

      <time className={nearLimit ? "voice-rec-time near" : "voice-rec-time"}>
        {formatMediaTime(clock)}
      </time>

      {phase === "recording" ? (
        <button
          type="button"
          className="voice-rec-stop"
          aria-label={t("recorder.finish")}
          title={t("recorder.finish")}
          onClick={capture.finish}
        >
          <span aria-hidden="true" />
        </button>
      ) : reviewing ? (
        <button
          type="button"
          className={sending ? "send voice-rec-send sending" : "send voice-rec-send"}
          aria-label={sending ? t("recorder.sending") : t("recorder.sendVoiceMessage")}
          aria-busy={sending}
          disabled={sending}
          onClick={() => void send()}
        >
          <Icon name="send" size={15} />
        </button>
      ) : phase === "error" ? (
        <button type="button" className="voice-rec-retry" onClick={() => void capture.start()}>
          {t("common.retry")}
        </button>
      ) : null}

      {message === null ? null : <p className="voice-rec-error" role="alert">{message}</p>}
    </div>
  );
}
