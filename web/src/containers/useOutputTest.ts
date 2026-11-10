"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { listOutputDevices } from "@/lib/voice/micPipeline";
import {
  applyAudioOutput,
  audioOutputSelectionSupported,
} from "@/lib/voice/playback";
import { RemoteVoiceMixer } from "@/lib/voice/remoteMixer";
import type { VoiceSettings } from "@/lib/voice/settings";
import type { OutputTest } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { useDeviceList } from "./useDeviceList";

const TEST_SOUND = "/sounds/voice-playback-test.mp3";
/** The strip the sample plays on, so it takes the same path as a remote voice. */
const PREVIEW_STRIP_ID = "settings-playback-preview";

/**
 * A real playback check on the call's own routing and receiver processing.
 *
 * The sample loops through a `RemoteVoiceMixer` strip, so a change to the
 * speaker, the volume or the playback profile is audible while it plays and
 * can be used to tune a profile rather than only to check a jack.
 */
export function useOutputTest(settings: VoiceSettings): OutputTest {
  const { t } = useLanguage();
  const { devices, labelsKnown } = useDeviceList(
    listOutputDevices,
    "voiceTest.speakerDevice",
  );
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What the sample is read from, and what actually reaches the speaker. */
  const source = useRef<HTMLAudioElement | null>(null);
  const output = useRef<HTMLAudioElement | null>(null);
  const mixer = useRef<RemoteVoiceMixer | null>(null);
  /** Bumped by every start and stop, so a start still in flight can tell it lost. */
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current += 1;
    mixer.current?.remove(PREVIEW_STRIP_ID);
    for (const element of new Set([source.current, output.current])) {
      if (element === null) continue;
      element.pause();
      element.currentTime = 0;
      element.onended = null;
      element.onerror = null;
    }
    source.current = null;
    output.current = null;
    setPlaying(false);
  }, []);

  const start = useCallback(() => {
    if (output.current !== null) return;
    const token = (run.current += 1);
    setError(null);

    const fail = (message: string) => {
      if (token !== run.current) return;
      stop();
      setError(message);
    };
    const createSample = () => {
      const element = new Audio(TEST_SOUND);
      element.preload = "auto";
      element.loop = true;
      element.onerror = () => fail(t("voiceTest.playFailed"));
      return element;
    };

    const sample = createSample();
    const processor =
      mixer.current ??
      new RemoteVoiceMixer(settings.playbackProfile, settings.playbackTuning);
    mixer.current = processor;
    processor.setProfile(settings.playbackProfile, settings.playbackTuning);

    const processedOutput = new Audio();
    const processed = processor.attachElement(
      PREVIEW_STRIP_ID,
      sample,
      processedOutput,
      100,
    );
    const heard = processed ? processedOutput : sample;
    source.current = sample;
    output.current = heard;

    void (async () => {
      try {
        await applyAudioOutput(heard, settings);
        if (token !== run.current) return;

        const resumed = processed ? await processor.resume() : true;
        if (token !== run.current) return;

        if (!resumed) {
          // A MediaElementAudioSourceNode owns its element for good. With the
          // context stuck suspended, replaying `sample` would report playback
          // while staying silent on Chromium and Safari, so a new element is
          // played raw instead.
          processor.remove(PREVIEW_STRIP_ID);
          sample.pause();
          sample.currentTime = 0;
          sample.onerror = null;
          const raw = createSample();
          source.current = raw;
          output.current = raw;
          await applyAudioOutput(raw, settings);
          if (token !== run.current) return;
          await raw.play();
        } else {
          if (processed) {
            await heard.play();
            if (token !== run.current) return;
          }
          await sample.play();
        }
        if (token !== run.current) return;
        setPlaying(true);
      } catch (cause) {
        fail(outputError(t, cause));
      }
    })();
  }, [settings, stop, t]);

  // Routing, volume and receiver EQ apply to the sample that is already
  // playing; only a failure to re-route stops it.
  useEffect(() => {
    mixer.current?.setProfile(settings.playbackProfile, settings.playbackTuning);
    const element = output.current;
    if (element === null) return;
    applyAudioOutput(element, settings).catch((cause) => {
      stop();
      setError(outputError(t, cause));
    });
  }, [settings, stop, t]);

  useEffect(
    () => () => {
      stop();
      mixer.current?.dispose();
      mixer.current = null;
    },
    [stop],
  );

  return {
    devices,
    labelsKnown,
    deviceSelectionSupported: audioOutputSelectionSupported(),
    playing,
    error,
    start,
    stop,
  };
}

function outputError(t: ReturnType<typeof useLanguage>["t"], cause: unknown): string {
  if (cause instanceof DOMException) {
    switch (cause.name) {
      case "NotAllowedError":
        return t("voiceTest.outputDenied");
      case "NotFoundError":
        return t("voiceTest.outputMissing");
      case "NotSupportedError":
        return t("voiceTest.outputUnsupported");
    }
  }
  return t("voiceTest.outputFailed");
}
