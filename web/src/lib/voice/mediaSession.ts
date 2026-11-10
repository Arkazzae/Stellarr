/**
 * The browser's bridge from a live WebRTC room to the system media surface.
 *
 * A call is not music, but mobile Chromium exposes the conferencing actions
 * through the Media Session API. Publishing the room there lets a supporting
 * browser keep the call visible on the lock screen and offer mute and hang-up
 * controls, without teaching the RTC client about the DOM.
 *
 * Everything here is progressive enhancement. Firefox, Safari and older
 * WebViews reject some conferencing actions, and a working call must never
 * depend on a lock-screen control being available.
 */

/** Conferencing actions that TypeScript's DOM typings do not list yet. */
interface ConferenceMediaSession extends MediaSession {
  setActionHandler(
    action: MediaSessionAction | "togglemicrophone" | "hangup",
    handler: MediaSessionActionHandler | null,
  ): void;
}

export interface CallMediaSessionState {
  title: string;
  subtitle: string;
  muted: boolean;
  cameraActive: boolean;
  onToggleMute(): void;
  onHangup(): void;
}

function currentMediaSession(): ConferenceMediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return null;
  return navigator.mediaSession;
}

/** Runs one step of the publication; an unsupported step throws or rejects and is skipped. */
function attempt(step: () => unknown): void {
  try {
    void Promise.resolve(step()).catch(() => undefined);
  } catch {
    // Unsupported conferencing methods normally throw NotSupportedError.
  }
}

export class CallMediaSessionController {
  private published = false;

  /** Publishes the call, or withdraws it when `state` is null. */
  sync(state: CallMediaSessionState | null): void {
    const session = currentMediaSession();
    if (session === null) return;

    if (state === null) {
      this.withdraw(session);
      return;
    }

    this.published = true;
    attempt(() => {
      session.metadata =
        typeof MediaMetadata === "undefined"
          ? null
          : new MediaMetadata({
              title: state.title,
              artist: state.subtitle,
              album: "Stellarr",
              artwork: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
            });
    });
    attempt(() => {
      session.playbackState = "playing";
    });
    attempt(() => session.setActionHandler("togglemicrophone", state.onToggleMute));
    attempt(() => session.setActionHandler("hangup", state.onHangup));
    attempt(() => session.setMicrophoneActive(!state.muted));
    attempt(() => session.setCameraActive(state.cameraActive));
  }

  dispose(): void {
    this.sync(null);
  }

  private withdraw(session: ConferenceMediaSession): void {
    if (!this.published) return;
    this.published = false;

    attempt(() => session.setActionHandler("togglemicrophone", null));
    attempt(() => session.setActionHandler("hangup", null));
    attempt(() => session.setMicrophoneActive(false));
    attempt(() => session.setCameraActive(false));
    attempt(() => {
      session.playbackState = "none";
    });
    attempt(() => {
      session.metadata = null;
    });
  }
}
