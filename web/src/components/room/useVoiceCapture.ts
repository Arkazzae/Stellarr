"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Translator } from "@/i18n";
import type { OpenVoiceMessageCapture, VoiceMessageCapture } from "@/ports";

import {
  BAR_COUNT,
  LEVEL_SAMPLE_MS,
  MAX_VOICE_MESSAGE_SECONDS,
  MIN_VOICE_MESSAGE_SECONDS,
  captureErrorMessage,
  preferredRecordingType,
  voiceMessageFile,
} from "./voiceRecording";

export type CapturePhase = "requesting" | "recording" | "preview" | "error";

export interface FinishedRecording {
  file: File;
  url: string;
  durationSeconds: number;
}

/**
 * Everything one attempt to record holds on to. Each event handler closes over
 * its own attempt, so a late callback from a cancelled or replaced attempt can
 * see that it is no longer `live` and do nothing.
 */
interface Attempt {
  live: boolean;
  capture: VoiceMessageCapture | null;
  recorder: MediaRecorder | null;
  context: AudioContext | null;
  meterFrame: number | null;
  startedAt: number;
  chunks: Blob[];
}

function newAttempt(): Attempt {
  return {
    live: true,
    capture: null,
    recorder: null,
    context: null,
    meterFrame: null,
    startedAt: 0,
    chunks: [],
  };
}

function stopRecorder(attempt: Attempt) {
  const { recorder } = attempt;
  if (recorder !== null && recorder.state !== "inactive") recorder.stop();
}

/** Safe to call twice: the second call finds nothing left to release. */
function releaseInput(attempt: Attempt) {
  if (attempt.meterFrame !== null) cancelAnimationFrame(attempt.meterFrame);
  attempt.meterFrame = null;
  const { capture, context } = attempt;
  attempt.capture = null;
  attempt.context = null;
  if (capture !== null) {
    capture.inputTrack.onended = null;
    capture.dispose();
  }
  void context?.close().catch(() => {});
}

function abandon(attempt: Attempt | null) {
  if (attempt === null) return;
  attempt.live = false;
  stopRecorder(attempt);
  releaseInput(attempt);
}

/**
 * Feeds `onLevel` with the loudness of the microphone, at most once per
 * `LEVEL_SAMPLE_MS`. The meter is an enhancement: a browser that can record but
 * cannot open an AudioContext still produces a valid note and a static line.
 */
function startLevelMeter(
  attempt: Attempt,
  recorder: MediaRecorder,
  stream: MediaStream,
  onLevel: (level: number) => void,
) {
  try {
    const context = new AudioContext();
    attempt.context = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let sampledAt = 0;

    const measure = (now: number) => {
      if (!attempt.live || recorder.state !== "recording") return;
      if (now - sampledAt >= LEVEL_SAMPLE_MS) {
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          energy += centred * centred;
        }
        const rms = Math.sqrt(energy / samples.length);
        onLevel(Math.min(1, Math.max(0.08, rms * 5.5)));
        sampledAt = now;
      }
      attempt.meterFrame = requestAnimationFrame(measure);
    };
    attempt.meterFrame = requestAnimationFrame(measure);
  } catch {
    // Recording carries on without a meter.
  }
}

/**
 * The microphone side of a voice message: opening it, recording, and handing
 * back the finished file. Whoever renders the result only has to show it.
 *
 * `start` is also the retry. Leaving the component, `discard` and a new `start`
 * all end the current attempt and release its microphone.
 */
export function useVoiceCapture(openMicrophone: OpenVoiceMessageCapture, t: Translator) {
  const [phase, setPhase] = useState<CapturePhase>("requesting");
  const [elapsed, setElapsed] = useState(0);
  /*
   * The live tape, newest last. It starts empty and grows in from the right
   * edge, one bar per sample: filling it with minimum-height bars up front drew
   * a flat line for silence that nobody had measured.
   */
  const [levels, setLevels] = useState<number[]>([]);
  const [ready, setReady] = useState<FinishedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useRef<Attempt | null>(null);
  // The latest props, so a parent that rebuilds them on every render does not
  // restart a recording that is under way.
  const inputs = useRef({ openMicrophone, t });
  useEffect(() => {
    inputs.current = { openMicrophone, t };
  });

  const start = useCallback(async () => {
    abandon(current.current);
    const attempt = newAttempt();
    current.current = attempt;
    setError(null);
    setReady(null);
    setElapsed(0);
    setLevels([]);
    setPhase("requesting");

    const fail = (message: string) => {
      if (!attempt.live) return;
      abandon(attempt);
      setError(message);
      setPhase("error");
    };

    if (typeof MediaRecorder === "undefined") {
      fail(inputs.current.t("recorder.unsupported"));
      return;
    }

    try {
      const capture = await inputs.current.openMicrophone();
      if (!attempt.live) {
        capture.dispose();
        return;
      }
      attempt.capture = capture;

      const mimeType = preferredRecordingType();
      const recorder = new MediaRecorder(capture.stream, {
        ...(mimeType === undefined ? {} : { mimeType }),
        audioBitsPerSecond: 64_000,
      });
      attempt.recorder = recorder;

      capture.inputTrack.onended = () => fail(inputs.current.t("recorder.interrupted"));
      recorder.onerror = () => fail(inputs.current.t("recorder.interrupted"));
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) attempt.chunks.push(event.data);
      };
      recorder.onstop = () => {
        attempt.recorder = null;
        releaseInput(attempt);
        if (!attempt.live) return;

        const seconds = (performance.now() - attempt.startedAt) / 1000;
        const durationSeconds = Math.min(MAX_VOICE_MESSAGE_SECONDS, Math.max(0, seconds));
        const type = recorder.mimeType || attempt.chunks[0]?.type || "audio/webm";
        const blob = new Blob(attempt.chunks, { type });
        attempt.chunks = [];

        if (blob.size === 0 || durationSeconds < MIN_VOICE_MESSAGE_SECONDS) {
          setError(inputs.current.t("recorder.tooShort"));
          setPhase("error");
          return;
        }

        const file = voiceMessageFile(blob, new Date());
        setReady({ file, url: URL.createObjectURL(file), durationSeconds });
        setElapsed(durationSeconds);
        setPhase("preview");
      };

      startLevelMeter(attempt, recorder, capture.stream, (level) =>
        setLevels((tape) => [...tape, level].slice(-BAR_COUNT)),
      );
      attempt.startedAt = performance.now();
      recorder.start(250);
      setPhase("recording");
    } catch (cause) {
      fail(captureErrorMessage(inputs.current.t, cause));
    }
  }, []);

  useEffect(() => {
    // Opening the microphone raises a permission prompt and calls back from the
    // device; neither belongs in the commit, so it starts one task later.
    const opener = window.setTimeout(() => void start(), 0);
    return () => {
      window.clearTimeout(opener);
      abandon(current.current);
    };
  }, [start]);

  const finish = useCallback(() => {
    if (current.current !== null) stopRecorder(current.current);
  }, []);

  const discard = useCallback(() => abandon(current.current), []);

  useEffect(() => {
    const attempt = current.current;
    if (phase !== "recording" || attempt === null) return;
    const timer = window.setInterval(() => {
      const seconds = (performance.now() - attempt.startedAt) / 1000;
      setElapsed(Math.min(MAX_VOICE_MESSAGE_SECONDS, seconds));
      if (seconds >= MAX_VOICE_MESSAGE_SECONDS) finish();
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase, finish]);

  useEffect(() => {
    if (ready === null) return;
    return () => URL.revokeObjectURL(ready.url);
  }, [ready]);

  return { phase, elapsed, levels, ready, error, start, finish, discard };
}
