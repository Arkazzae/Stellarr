import { useCallback, useEffect, useRef } from "react";

/**
 * The listener's own playback preferences, for auditioning a clip.
 *
 * A bare `new Audio()` has no chosen speaker, no output level and no
 * soundboard level. On a machine whose calls are routed somewhere other than
 * the system default it plays into a device nobody is listening to, which is
 * indistinguishable from a preview that does not work.
 */
export interface SoundPreviewPlayback {
  /** The call's own output level, 0-100. */
  outputVolume: number;
  /** The soundboard's, 0-100: the dial the editor also offers. */
  soundboardVolume: number;
  /**
   * Sends the preview to the speaker calls are routed to. Supplied by the
   * container, which owns the transport. Failure is not fatal: the system
   * default is still a speaker.
   */
  route?: (element: HTMLMediaElement) => Promise<void>;
}

export interface PreviewClip {
  url: string;
  start: number;
  end: number;
}

/** Only a permanently stalled resource ever reaches this; see `play`. */
const STALL_GUARD_MS = 30_000;

function detach(audio: HTMLAudioElement): void {
  audio.onloadedmetadata = null;
  audio.ontimeupdate = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
}

/** Plays one trimmed clip at a time, at the level a call would play it. */
export function useSoundPreview(playback: SoundPreviewPlayback) {
  const current = useRef<HTMLAudioElement | null>(null);
  const stallGuard = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Output level times soundboard level, the way a played clip is mixed.
  const volume = Math.min(
    1,
    Math.max(0, (playback.outputVolume / 100) * (playback.soundboardVolume / 100)),
  );

  const stop = useCallback(() => {
    if (stallGuard.current !== null) clearTimeout(stallGuard.current);
    stallGuard.current = null;
    const audio = current.current;
    current.current = null;
    if (audio !== null) detach(audio);
  }, []);

  // A slider moved while the clip is running is heard on that clip, not only
  // on the next one.
  useEffect(() => {
    if (current.current !== null) current.current.volume = volume;
  }, [volume]);

  useEffect(() => stop, [stop]);

  /** `onBlocked` runs when the browser or the file refuses to play it. */
  const play = (clip: PreviewClip, onBlocked: () => void) => {
    stop();
    const audio = new Audio(clip.url);
    audio.preload = "auto";
    // Silent until it sits on the trim start: the element is started inside
    // the click that asked for it, the gesture a webview's autoplay rules look
    // for, and the head of the clip must not be heard on the way.
    audio.muted = true;
    audio.volume = volume;
    void playback.route?.(audio).catch(() => undefined);
    current.current = audio;

    const fail = () => {
      if (current.current !== audio) return;
      stop();
      onBlocked();
    };
    let seeked = false;
    const seek = () => {
      if (seeked || current.current !== audio) return;
      seeked = true;
      try {
        audio.currentTime = Math.max(0, clip.start);
      } catch {
        fail();
        return;
      }
      audio.muted = false;
    };
    audio.onloadedmetadata = seek;
    audio.ontimeupdate = () => {
      if (audio.currentTime >= clip.end) stop();
    };
    audio.onended = stop;
    audio.onerror = fail;
    void audio
      .play()
      .then(() => {
        if (current.current !== audio) return;
        // timeupdate follows real media progress; this only stops a leak.
        stallGuard.current = setTimeout(stop, STALL_GUARD_MS);
      })
      .catch(fail);
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
  };

  return { play, stop };
}
