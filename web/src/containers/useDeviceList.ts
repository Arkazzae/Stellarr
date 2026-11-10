"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasDeviceLabels } from "@/lib/voice/micPipeline";
import type { MediaDeviceChoice } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** The label given to an entry the browser has not named yet; `{count}` is its place. */
type FallbackLabel =
  | "voiceTest.micDevice"
  | "voiceTest.speakerDevice"
  | "voiceTest.cameraDevice";

export interface DeviceList {
  devices: readonly MediaDeviceChoice[];
  /** False until the browser has been granted permission at least once. */
  labelsKnown: boolean;
  /** Reads the list again, for when permission has just been granted. */
  refresh: () => void;
}

/**
 * The devices of one kind, kept current while the settings dialog is open.
 *
 * `list` is passed in rather than chosen here: each test hook names the lister
 * it needs, and a plug or unplug is announced by `devicechange` for all kinds.
 * The raw entries are stored and the labels are derived on render, so a change
 * of language relabels the anonymous ones without another enumeration.
 */
export function useDeviceList(
  list: () => Promise<MediaDeviceInfo[]>,
  fallback: FallbackLabel,
): DeviceList {
  const { t } = useLanguage();
  const [found, setFound] = useState<readonly MediaDeviceInfo[]>([]);
  // Only the newest enumeration may land: a slow one that started before a
  // plug event must not overwrite the answer that came after it.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = (latest.current += 1);
    void list().then((entries) => {
      if (request === latest.current) setFound(entries);
    });
  }, [list]);

  useEffect(() => {
    refresh();
    const media = typeof navigator === "undefined" ? null : navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refresh);
    return () => {
      latest.current += 1;
      media?.removeEventListener?.("devicechange", refresh);
    };
  }, [refresh]);

  const devices = useMemo(
    () =>
      found.map((device, index) => ({
        deviceId: device.deviceId,
        // Before permission every label is empty; numbering them still lets
        // the select say "there are three of these".
        label: device.label || t(fallback, { count: index + 1 }),
      })),
    [fallback, found, t],
  );

  return { devices, labelsKnown: hasDeviceLabels(found), refresh };
}
