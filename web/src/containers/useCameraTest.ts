"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { listVideoDevices } from "@/lib/voice/micPipeline";
import type { VoiceSettings } from "@/lib/voice/settings";
import type { CameraTest } from "@/ports";
import { useLanguage } from "@/state/hooks";

import { useDeviceList } from "./useDeviceList";

/**
 * A local camera preview.
 *
 * The stream is shown to the person choosing a camera and goes nowhere else:
 * it is never offered to a call. Every track is stopped when the preview ends,
 * the pane unmounts or the tab is hidden, because a camera light left on by a
 * closed dialog reads as being watched.
 */
export function useCameraTest(settings: VoiceSettings): CameraTest {
  const { t } = useLanguage();
  const { devices, labelsKnown, refresh } = useDeviceList(
    listVideoDevices,
    "voiceTest.cameraDevice",
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = useRef<MediaStream | null>(null);
  /** Bumped when the preview is released, so a late `getUserMedia` is discarded. */
  const run = useRef(0);
  /** The camera of the last committed render, so `open` need not depend on it. */
  const applied = useRef(settings.videoDeviceId);

  const release = useCallback(() => {
    run.current += 1;
    current.current?.getTracks().forEach((track) => track.stop());
    current.current = null;
    setStream(null);
  }, []);

  const stop = useCallback(() => {
    release();
    setStarting(false);
  }, [release]);

  const open = useCallback(() => {
    release();
    const token = run.current;
    setStarting(true);
    setError(null);

    void (async () => {
      try {
        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) {
          throw new DOMException("Camera unsupported", "NotSupportedError");
        }
        const deviceId = applied.current;
        const opened = await media.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            ...(deviceId === null ? {} : { deviceId: { exact: deviceId } }),
          },
        });
        if (token !== run.current) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        current.current = opened;
        setStream(opened);
        setStarting(false);
        // Labels exist now that permission has been granted.
        refresh();
      } catch (cause) {
        if (token !== run.current) return;
        setStarting(false);
        setError(cameraError(t, cause));
      }
    })();
  }, [refresh, release, t]);

  const start = useCallback(() => {
    if (current.current !== null || starting) return;
    open();
  }, [open, starting]);

  // Picking another camera swaps the preview rather than ending it.
  useEffect(() => {
    const previous = applied.current;
    applied.current = settings.videoDeviceId;
    if (current.current !== null && previous !== settings.videoDeviceId) open();
  }, [settings.videoDeviceId, open]);

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
    running: stream !== null,
    starting,
    stream,
    error,
    start,
    stop,
  };
}

function cameraError(t: ReturnType<typeof useLanguage>["t"], cause: unknown): string {
  if (cause instanceof DOMException) {
    switch (cause.name) {
      case "NotAllowedError":
      case "SecurityError":
        return t("voiceTest.cameraDenied");
      case "NotFoundError":
      case "OverconstrainedError":
        return t("voiceTest.cameraMissing");
      case "NotSupportedError":
        return t("voiceTest.cameraUnsupported");
    }
  }
  return t("voiceTest.cameraFailed");
}
