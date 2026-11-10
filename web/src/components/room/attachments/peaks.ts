"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * The waveform of an audio file, measured from the file itself.
 *
 * Nothing on the server decodes uploads, so the shape a reader sees is either
 * computed here or invented, and an invented one looks like information it is
 * not. Measuring costs a full download and decode, so it is paid once per URL,
 * shared by every message that shows the file, and only for files small enough
 * that the download goes unnoticed.
 */

/** Above this, the picture is not worth the bytes. Voice notes are far below. */
export const MAX_PEAK_BYTES = 12 * 1024 * 1024;

/** How many bars a waveform is drawn with, unless the row it sits in says otherwise. */
export const BAR_COUNT = 56;

interface Measurement {
  /** `peaks` is absent while loading and after a failure. */
  peaks?: number[];
}

/**
 * Keyed by URL and resolution, at module level on purpose: the same voice note
 * can appear in a quoted reply and in the transcript and should be decoded once.
 * It changes on its own schedule, outside any render, so components read it as
 * an external store; a decode that finishes between render and effect is then
 * not missed.
 */
const measurements = new Map<string, Measurement>();
const listeners = new Map<string, Set<() => void>>();

function subscribe(key: string, onChange: () => void): () => void {
  const forKey = listeners.get(key) ?? new Set();
  forKey.add(onChange);
  listeners.set(key, forKey);
  return () => {
    forKey.delete(onChange);
    if (forKey.size === 0) listeners.delete(key);
  };
}

function record(key: string, measurement: Measurement): void {
  measurements.set(key, measurement);
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * Reduces decoded samples to `bars` bars, each the RMS of its slice. A peak
 * detector would turn a recording with one door slam into a flat line and a
 * spike, whereas RMS draws what the ear calls loudness. The result is scaled so
 * the loudest bar is 1: a quiet recording still fills the row.
 */
export function peaksFrom(channel: Float32Array, bars = BAR_COUNT): number[] {
  const size = Math.floor(channel.length / bars);
  if (size < 1) return new Array<number>(bars).fill(0);

  const levels = Array.from({ length: bars }, (_, bar) => {
    let sum = 0;
    for (let i = bar * size; i < (bar + 1) * size; i += 1) {
      const sample = channel[i] ?? 0;
      sum += sample * sample;
    }
    return Math.sqrt(sum / size);
  });

  const loudest = Math.max(...levels);
  return loudest === 0 ? levels : levels.map((level) => level / loudest);
}

async function measure(url: string, bars: number): Promise<number[] | null> {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextClass === undefined) return null;

  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) return null;

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PEAK_BYTES) return null;

  // Closed straight away: an open AudioContext holds an audio thread, and a
  // channel of voice notes would otherwise hold one per message.
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(bytes);
    return peaksFrom(buffer.getChannelData(0), bars);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Peaks for `url`, or null while they are unknown. That covers loading, a file
 * too large to be worth it, a format this browser cannot decode and a failed
 * request alike: each means "draw the placeholder".
 *
 * `bars` is how finely the file is measured. How many fit is a question about
 * the row they are drawn in, so it is part of the cache key: two resolutions of
 * one file are two answers.
 */
export function useAudioPeaks(
  url: string | undefined,
  enabled: boolean,
  bars = BAR_COUNT,
): number[] | null {
  const key = url === undefined ? undefined : `${url}#${bars}`;
  const subscribeToKey = useCallback(
    (onChange: () => void) => (key === undefined ? () => {} : subscribe(key, onChange)),
    [key],
  );
  const snapshot = useCallback(
    () => (key === undefined ? null : (measurements.get(key)?.peaks ?? null)),
    [key],
  );
  // Nothing is decoded on the server, so the first paint is the placeholder.
  const peaks = useSyncExternalStore(subscribeToKey, snapshot, () => null);

  useEffect(() => {
    if (url === undefined || key === undefined || !enabled) return;
    // Measured, failed, or being measured by another row: the store has it.
    if (measurements.has(key)) return;

    measurements.set(key, {});
    measure(url, bars).then(
      (measured) => record(key, measured === null ? {} : { peaks: measured }),
      // A waveform is decoration; a failed one is a placeholder, not an error.
      () => record(key, {}),
    );
  }, [url, key, bars, enabled]);

  return peaks;
}
