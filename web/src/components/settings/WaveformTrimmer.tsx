"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { useLanguage } from "@/state/hooks";

const BAR_COUNT = 96;
const MIN_CLIP_SECONDS = 0.15;
export const MAX_CLIP_SECONDS = 15;
/** One arrow-key press moves a handle, or the whole selection, this far. */
const NUDGE_SECONDS = 0.05;
/** The quietest bar is still drawn, so a silent clip does not look missing. */
const MIN_PEAK = 0.04;

export interface DecodedWaveform {
  duration: number;
  peaks: number[];
}

function peaksOf(buffer: AudioBuffer): number[] {
  const peaks = Array.from({ length: BAR_COUNT }, (_, bar) => {
    const from = Math.floor((bar / BAR_COUNT) * buffer.length);
    const to = Math.max(from + 1, Math.floor(((bar + 1) / BAR_COUNT) * buffer.length));
    // Long clips are sampled rather than scanned: about 64 samples per bar is
    // plenty to draw it.
    const stride = Math.max(1, Math.floor((to - from) / 64));
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = from; index < to; index += stride) {
        peak = Math.max(peak, Math.abs(samples[index] ?? 0));
      }
    }
    return peak;
  });
  const loudest = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.max(MIN_PEAK, peak / loudest));
}

/** Decodes the same bytes later uploaded and reduces them to display peaks. */
export async function decodeWaveform(source: Blob | ArrayBuffer): Promise<DecodedWaveform> {
  const bytes = source instanceof Blob ? await source.arrayBuffer() : source;
  const context = new AudioContext();
  try {
    // decodeAudioData detaches the buffer it is given; the caller keeps theirs.
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (
      !Number.isFinite(buffer.duration) ||
      buffer.duration <= 0 ||
      buffer.length <= 0 ||
      buffer.numberOfChannels <= 0
    ) {
      throw new Error("Decoded audio is empty");
    }
    return { duration: buffer.duration, peaks: peaksOf(buffer) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

type Edge = "start" | "end";

type Drag =
  | { kind: Edge }
  | { kind: "selection"; originX: number; initialStart: number; initialEnd: number };

/** `m:ss.cc`, the form a clip's trim points are read out in. */
function timecode(value: number): string {
  const total = Number.isFinite(value) ? value : 0;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

export interface WaveformTrimmerProps extends DecodedWaveform {
  start: number;
  end: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
}

/**
 * A waveform with two handles and the stretch between them. Handles and the
 * selection can be dragged or moved with the arrow keys; the selection keeps
 * to the minimum and maximum clip length, and to the clip itself.
 */
export function WaveformTrimmer({
  duration,
  peaks,
  start,
  end,
  disabled = false,
  onChange,
}: WaveformTrimmerProps) {
  const { t } = useLanguage();
  const drag = useRef<Drag | null>(null);

  const moveEdge = (edge: Edge, value: number) => {
    if (edge === "start") {
      onChange(
        Math.max(0, end - MAX_CLIP_SECONDS, Math.min(end - MIN_CLIP_SECONDS, value)),
        end,
      );
    } else {
      onChange(
        start,
        Math.min(duration, start + MAX_CLIP_SECONDS, Math.max(start + MIN_CLIP_SECONDS, value)),
      );
    }
  };

  const moveSelection = (initialStart: number, initialEnd: number, delta: number) => {
    const length = initialEnd - initialStart;
    const nextStart = Math.max(0, Math.min(Math.max(0, duration - length), initialStart + delta));
    onChange(nextStart, nextStart + length);
  };

  const dragEdgeTo = (edge: Edge, clientX: number, plot: DOMRect) => {
    if (plot.width <= 0) return;
    moveEdge(edge, ((clientX - plot.left) / plot.width) * duration);
  };

  const nudgeDirection = (event: KeyboardEvent): number | null => {
    if (disabled) return null;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
    event.preventDefault();
    return event.key === "ArrowLeft" ? -NUDGE_SECONDS : NUDGE_SECONDS;
  };

  const nudgeEdge = (edge: Edge, event: KeyboardEvent) => {
    const delta = nudgeDirection(event);
    if (delta !== null) moveEdge(edge, (edge === "start" ? start : end) + delta);
  };

  const grabEdge = (edge: Edge, event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    drag.current = { kind: edge };
    event.currentTarget.setPointerCapture(event.pointerId);
    const plot = event.currentTarget.parentElement?.getBoundingClientRect();
    if (plot !== undefined) dragEdgeTo(edge, event.clientX, plot);
  };

  const grabSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    drag.current = {
      kind: "selection",
      originX: event.clientX,
      initialStart: start,
      initialEnd: end,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drive = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    const plot = event.currentTarget.getBoundingClientRect();
    if (current.kind !== "selection") {
      dragEdgeTo(current.kind, event.clientX, plot);
    } else if (plot.width > 0) {
      const delta = ((event.clientX - current.originX) / plot.width) * duration;
      moveSelection(current.initialStart, current.initialEnd, delta);
    }
  };

  const release = () => {
    drag.current = null;
  };

  const percent = (value: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(duration) || duration <= 0) return 0;
    return Math.min(100, Math.max(0, (value / duration) * 100));
  };
  const startPercent = percent(start);
  const endPercent = percent(end);
  const tabIndex = disabled ? -1 : 0;

  return (
    <div className="wave-editor">
      <div
        className="wave-plot"
        onPointerMove={drive}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <svg viewBox={`0 0 ${peaks.length * 3} 100`} preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((peak, index) => {
            const height = Math.max(4, peak * 88);
            return (
              <rect key={index} x={index * 3} y={(100 - height) / 2} width="2" height={height} rx="1" />
            );
          })}
        </svg>
        <span className="wave-mask left" style={{ width: `${startPercent}%` }} />
        <span className="wave-mask right" style={{ left: `${endPercent}%` }} />
        <div
          className="wave-selection"
          style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
          role="slider"
          tabIndex={tabIndex}
          aria-label={t("waveform.selection")}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, duration - (end - start))}
          aria-valuenow={start}
          aria-valuetext={`${timecode(start)}–${timecode(end)}`}
          onPointerDown={grabSelection}
          onKeyDown={(event) => {
            const delta = nudgeDirection(event);
            if (delta !== null) moveSelection(start, end, delta);
          }}
        />
        <div
          className="wave-clamp start"
          style={{ left: `${startPercent}%` }}
          role="slider"
          tabIndex={tabIndex}
          aria-label={t("waveform.start")}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, end - MIN_CLIP_SECONDS)}
          aria-valuenow={start}
          aria-valuetext={timecode(start)}
          onPointerDown={(event) => grabEdge("start", event)}
          onKeyDown={(event) => nudgeEdge("start", event)}
        />
        <div
          className="wave-clamp end"
          style={{ left: `${endPercent}%` }}
          role="slider"
          tabIndex={tabIndex}
          aria-label={t("waveform.end")}
          aria-valuemin={start + MIN_CLIP_SECONDS}
          aria-valuemax={Math.min(duration, start + MAX_CLIP_SECONDS)}
          aria-valuenow={end}
          aria-valuetext={timecode(end)}
          onPointerDown={(event) => grabEdge("end", event)}
          onKeyDown={(event) => nudgeEdge("end", event)}
        />
      </div>
      <div className="wave-times">
        <span>{timecode(start)}</span>
        <b>{(end - start).toFixed(2)} s</b>
        <span>{timecode(end)}</span>
      </div>
    </div>
  );
}
