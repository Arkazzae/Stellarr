import type { UserId, VoiceOccupant } from "@/lib/api/types";
import type { RtcStatePayload } from "@/lib/rtc/protocol";
import type { ParticipantPreference } from "./participantPreferences";
import type { RemoteAudio } from "./webrtcRemoteAudio";
import { RemoteMedia } from "./webrtcRemoteMedia";

/**
 * What plays one remote audio source, a microphone or a screen share's sound:
 * an audible sink and a muted decoding sink.
 */
export interface RemoteVoice {
  /** The audible element. Holds the mixer's output, or the raw stream as a fallback. */
  audio: HTMLAudioElement;
  /** Muted direct sink that keeps Chromium's WebRTC jitter buffer decoding. */
  decoder: HTMLAudioElement;
  /** False when Web Audio was unavailable and the raw remote stream is playing. */
  processed: boolean;
  /** The stream currently attached, if any. */
  streamId: string | null;
}

/**
 * One other person in the call, whatever connection their media arrives on.
 *
 * Everything here belongs to the person: how they are named and heard on this
 * machine, what they say they send, and which of their streams is which. The
 * connection is deliberately not here: everybody arrives on the same one to
 * the media server, and its directory says whose track is whose.
 */
export interface Participant {
  readonly userId: UserId;
  displayName: string;
  muted: boolean;
  speaking: boolean;
  /** Smoothed input level, 0..1. */
  level: number;
  /** Local receiver-side strip, 0..200 percent. */
  playbackVolume: number;
  /** Local receiver-side gate on this person's strip. */
  gated: boolean;
  /** Local receiver-side suppressor on this person's strip. */
  suppressed: boolean;
  readonly voice: RemoteVoice;
  /** Sinks for their shared-screen sound, which never shares an element with the voice. */
  screenAudio: RemoteVoice | null;
  /** Every remote stream seen, so routing can be re-evaluated at will. */
  readonly media: RemoteMedia;
}

export interface ParticipantInit {
  user: VoiceOccupant;
  /** How this account last heard the person. */
  preference: ParticipantPreference;
  /** Builds the person's voice sinks. */
  createVoice(): RemoteVoice;
}

export function createParticipant(init: ParticipantInit): Participant {
  const { user, preference } = init;
  return {
    userId: user.userId,
    displayName: user.displayName,
    muted: user.muted,
    speaking: false,
    level: 0,
    playbackVolume: preference.volume,
    gated: preference.gated,
    suppressed: preference.suppressed,
    voice: init.createVoice(),
    screenAudio: null,
    media: new RemoteMedia(),
  };
}

/** What filing a person's media needs from the call. */
export interface ParticipantMediaEnv {
  readonly remoteAudio: Pick<RemoteAudio, "receive" | "route">;
  /** What a person publishes to the UI has changed. */
  changed(): void;
}

/**
 * A remote track of `person` arrived: file it, then let everything be placed
 * again. Saying whose track it is belongs to the media server's directory.
 * `id` is what the person calls the stream, which their state frame compares
 * against: the directory's `streamId`, not the browser's stream id.
 */
export function receiveRemoteTrack(
  env: ParticipantMediaEnv,
  person: Participant,
  track: MediaStreamTrack,
  stream: MediaStream,
  id: string,
): void {
  if (track.kind === "audio") {
    env.remoteAudio.receive(person, stream, track, id);
  } else if (track.kind === "video") {
    person.media.addVideo(stream, id);
    track.onended = () => {
      // Only an announced share takes its sound with it. The rest waits for
      // the next pass, so a share nobody announced does not take the voice's
      // sink the moment its picture stops.
      if (person.media.removeVideo(id)) env.remoteAudio.route(person);
      env.changed();
    };
    mediaChanged(env, person);
  }
}

/** Take a person's own account of their mute, their screen and their camera. */
export function receiveRemoteState(
  env: ParticipantMediaEnv,
  person: Participant,
  state: RtcStatePayload,
): void {
  person.muted = state.muted;
  person.media.announce(state);
  mediaChanged(env, person);
}

/**
 * What a person sends became clearer, or went away. Video can identify the
 * sound of a share that arrived first, so the sinks are settled before the UI
 * is told.
 */
function mediaChanged(env: ParticipantMediaEnv, person: Participant): void {
  env.remoteAudio.route(person);
  env.changed();
}
