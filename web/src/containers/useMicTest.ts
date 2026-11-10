"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  captureMicrophone,
  listInputDevices,
  MicCaptureError,
  type MicCapture,
} from "@/lib/voice/micPipeline";
import { needsRecapture, type VoiceSettings } from "@/lib/voice/settings";
import { SpeechDetector } from "@/lib/voice/vad";
import type {
  ActiveAutoGain,
  ActiveNoiseSuppression,
  MicTest,
} from "@/ports";
import { useLanguage } from "@/state/hooks";

import { useDeviceList } from "./useDeviceList";

/** The id the detector files the one stream under; nothing else is attached. */
const SOURCE = "mic-test";

/**
 * How far the peak marker falls on each tick, and how often it ticks.
 *
 * Slow enough that one syllable stays readable, fast enough that the marker
 * never describes a noise from several seconds ago.
 */
const PEAK_DECAY = 0.06;
const PEAK_TICK_MS = 90;

type Status = "idle" | "starting" | "running";

/** Everything the meter shows about the open microphone. */
interface Readout {
  level: number;
  peak: number;
  speaking: boolean;
  noiseSuppression: ActiveNoiseSuppression | null;
  gateActive: boolean | null;
  autoGain: ActiveAutoGain | null;
  deviceId: string | null;
}

const SILENT: Readout = {
  level: 0,
  peak: 0,
  speaking: false,
  noiseSuppression: null,
  gateActive: null,
  autoGain: null,
  deviceId: null,
};

/**
 * Listening to yourself in the settings, without joining a call.
 *
 * This is the only place outside a call that opens the microphone, so it owns
 * everything it creates: the capture (device track, graph nodes, AudioContext)
 * and the detector. Both go when the test stops, when the pane unmounts and
 * when the tab is hidden. A dialog left open behind another window must not
 * keep the operating system's microphone indicator lit; from the outside that
 * looks exactly like an app that is listening.
 *
 * The detector is the call's own, on the call's own settings, so "speaking"
 * here means what it will mean in a call. A friendlier meter would lie.
 */
export function useMicTest(settings: VoiceSettings): MicTest {
  const { t } = useLanguage();
  const { devices, labelsKnown, refresh } = useDeviceList(
    listInputDevices,
    "voiceTest.micDevice",
  );
  const [status, setStatus] = useState<Status>("idle");
  const [readout, setReadout] = useState<Readout>(SILENT);
  const [error, setError] = useState<string | null>(null);

  const capture = useRef<MicCapture | null>(null);
  const detector = useRef<SpeechDetector | null>(null);
  /**
   * Bumped whenever the open microphone is released. An open that is still
   * waiting on `getUserMedia` compares the number it started with and discards
   * its result; otherwise pressing stop in that window would leave a live
   * device track that nothing refers to.
   */
  const run = useRef(0);
  /**
   * The settings of the last committed render. `open` reads this rather than
   * depending on `settings`, so the callbacks keep their identity while the
   * sensitivity dial is dragged.
   */
  const applied = useRef(settings);

  const release = useCallback(() => {
    run.current += 1;
    detector.current?.dispose();
    detector.current = null;
    if (capture.current) capture.current.rawTrack.onended = null;
    capture.current?.dispose();
    capture.current = null;
    setReadout(SILENT);
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus("idle");
  }, [release]);

  /**
   * Opens the microphone, replacing whatever is open.
   *
   * One path for both "press play" and "the device changed underneath": the
   * release and the new capture sit either side of one `await`, and the run
   * number makes a slow earlier attempt lose to a later one.
   */
  const open = useCallback(() => {
    release();
    const token = run.current;
    setError(null);
    setStatus("starting");

    void (async () => {
      try {
        const opened = await captureMicrophone(applied.current);
        if (token !== run.current) {
          opened.dispose();
          return;
        }
        capture.current = opened;
        opened.rawTrack.onended = () => {
          if (token !== run.current) return;
          stop();
          setError(t("voiceTest.micFailed"));
        };

        const speech = new SpeechDetector(
          (_id, reading) =>
            setReadout((shown) => ({
              ...shown,
              level: reading.level,
              peak: Math.max(shown.peak, reading.level),
              speaking: reading.speaking,
            })),
          { sensitivity: applied.current.vadSensitivity },
        );
        detector.current = speech;
        // Listens before the gate, so the meter shows the room even while
        // nothing would be sent. That is what the test is for.
        await speech.add(SOURCE, opened.monitorStream, true);
        if (token !== run.current) return;

        setStatus("running");
        // What the device is really doing: asking for RNNoise does not mean
        // getting it, which is why the pipeline reports it.
        setReadout((shown) => ({
          ...shown,
          noiseSuppression: opened.noiseSuppression,
          gateActive: opened.gateActive,
          autoGain: opened.autoGain,
          deviceId: deviceIdOf(opened.rawTrack),
        }));
        // Labels exist now that permission has been granted.
        refresh();
      } catch (cause) {
        if (token !== run.current) return;
        setStatus("idle");
        setError(
          cause instanceof MicCaptureError ? cause.message : t("voiceTest.micFailed"),
        );
      }
    })();
  }, [refresh, release, stop, t]);

  const start = useCallback(() => {
    if (capture.current || status === "starting") return;
    open();
  }, [open, status]);

  // The meter follows the sensitivity dial with the message the call sends, so
  // it reacts without dropping the learned noise floor.
  useEffect(() => {
    detector.current?.setSensitivity(settings.vadSensitivity);
  }, [settings.vadSensitivity]);

  useEffect(() => {
    capture.current?.setInputGain(settings.inputGainDb);
  }, [settings.inputGainDb]);

  // A different device or suppressor needs the microphone reopened rather than
  // stopped: choosing between three microphones is the point of this screen,
  // and a test that switched itself off after each pick would need three
  // presses of play to hear three devices.
  useEffect(() => {
    const previous = applied.current;
    applied.current = settings;
    if (capture.current && needsRecapture(previous, settings)) open();
  }, [settings, open]);

  // The peak marker falls by itself and readings only push it up, so the timer
  // exists only while there is something to lower.
  const running = status === "running";
  const { peak } = readout;
  useEffect(() => {
    if (!running || peak === 0) return;
    const handle = window.setInterval(() => {
      setReadout((shown) => ({
        ...shown,
        peak: Math.max(0, shown.peak - PEAK_DECAY),
      }));
    }, PEAK_TICK_MS);
    return () => window.clearInterval(handle);
  }, [running, peak]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return {
    devices,
    labelsKnown,
    running,
    starting: status === "starting",
    level: readout.level,
    peak,
    speaking: readout.speaking,
    error,
    activeNoiseSuppression: readout.noiseSuppression,
    gateActive: readout.gateActive,
    autoGain: readout.autoGain,
    activeDeviceLabel:
      devices.find((device) => device.deviceId === readout.deviceId)?.label ?? null,
    start,
    stop,
  };
}

/**
 * The device a live track landed on. `getSettings` is missing on older engines
 * and can throw on a track that has ended, and neither is worth failing a
 * working test over.
 */
function deviceIdOf(track: MediaStreamTrack): string | null {
  try {
    return track.getSettings?.().deviceId ?? null;
  } catch {
    return null;
  }
}
