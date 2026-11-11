import { videoStreamIds } from "./sdp";
import type { VoiceCamera, VoiceScreenShare } from "./types";

/** What an audio stream carries: somebody's voice, or the sound of their screen share. */
export type AudioRole = "microphone" | "screen";

/** What the other person says they are sending, from their state frame. */
export interface MediaAnnouncement {
  screenStreamId: string | null;
  cameraStreamId: string | null;
}

/**
 * Everything one remote person sends, and which stream is which.
 *
 * Nothing here depends on arrival order. Tracks, the remote description and the
 * person's own announcement turn up in any sequence (screen audio routinely
 * beats both the microphone and the announcement), so this only records what
 * has been seen and answers `roleOf` from the whole picture. Owners ask again
 * after every change, and the answer is always the best one available so far.
 */
export class RemoteMedia {
  private readonly audio = new Map<string, MediaStream>();
  private readonly video = new Map<string, MediaStream>();
  /** Stream ids known to carry video, from the remote description or a track. */
  private readonly videoIds = new Set<string>();
  /**
   * Stream ids with a sound: an audio track event arrived, or the video's own
   * stream already held an audio track when it did.
   */
  private readonly soundIds = new Set<string>();
  private screenId: string | null = null;
  private cameraId: string | null = null;

  /**
   * File an audio stream under `id`. That is the stream's own id unless the
   * one who knows whose track it is names another, as a media server's
   * directory does: there the browser's stream id is only a hint fixed when
   * the section was made.
   */
  addAudio(stream: MediaStream, id: string = stream.id): void {
    this.audio.set(id, stream);
    this.soundIds.add(id);
  }

  hasAudio(streamId: string): boolean {
    return this.audio.has(streamId);
  }

  /** Whether this very stream is filed as audio, under whatever id. */
  holdsAudio(stream: MediaStream): boolean {
    for (const filed of this.audio.values()) {
      if (filed === stream) return true;
    }
    return false;
  }

  /** False when the stream was not known, so a late `ended` event does nothing. */
  removeAudio(streamId: string): boolean {
    this.soundIds.delete(streamId);
    return this.audio.delete(streamId);
  }

  /** File a video stream under `id`; see `addAudio` for when that is not its own id. */
  addVideo(stream: MediaStream, id: string = stream.id): void {
    this.video.set(id, stream);
    this.videoIds.add(id);
    // The browser puts a stream's tracks on it before it reports any of them.
    if (stream.getAudioTracks().length > 0) this.soundIds.add(id);
  }

  /**
   * A video track ended, and no longer counts as evidence of what the stream's
   * audio is. True when an announced share or camera ended with it, which takes
   * a share's sound along: the caller has to place the audio streams again.
   */
  removeVideo(streamId: string): boolean {
    this.video.delete(streamId);
    this.videoIds.delete(streamId);
    const announced = streamId === this.screenId || streamId === this.cameraId;
    if (streamId === this.screenId) this.clearScreen();
    if (streamId === this.cameraId) this.clearCamera();
    return announced;
  }

  /** The remote description names the video msids before any track event fires. */
  learnFromSdp(sdp: string | undefined | null): void {
    for (const id of videoStreamIds(sdp)) this.learnVideo(id);
  }

  /**
   * A stream id is known to carry video before its track arrives, from a
   * remote description or a media server's directory.
   */
  learnVideo(streamId: string): void {
    this.videoIds.add(streamId);
  }

  /**
   * Take the person's own account of their screen and camera. A stream id that
   * is replaced or withdrawn is forgotten completely, so it can never come
   * back later under another role.
   */
  announce(announcement: MediaAnnouncement): void {
    if (announcement.screenStreamId !== this.screenId) this.clearScreen();
    if (announcement.cameraStreamId !== this.cameraId) this.clearCamera();
    this.screenId = announcement.screenStreamId;
    this.cameraId = announcement.cameraStreamId;
  }

  /**
   * A stream is a screen share's sound when the person announced it or video
   * was seen on it; Stellarr cameras are captured without audio, so nothing
   * else can be. With no evidence yet it is taken for a microphone, and
   * `roleOf` moves it as soon as evidence arrives.
   */
  roleOf(streamId: string): AudioRole {
    if (streamId === this.cameraId) return "microphone";
    return streamId === this.screenId || this.videoIds.has(streamId) ? "screen" : "microphone";
  }

  /** The most recently received audio stream with this role. */
  newestAudio(role: AudioRole): MediaStream | null {
    let newest: MediaStream | null = null;
    for (const [id, stream] of this.audio) {
      if (this.roleOf(id) === role) newest = stream;
    }
    return newest;
  }

  /** The announced share, once its video has arrived. */
  get screen(): VoiceScreenShare | null {
    const id = this.screenId;
    const stream = id === null ? undefined : this.video.get(id);
    if (id === null || !stream) return null;
    return { streamId: id, hasAudio: this.soundIds.has(id), stream };
  }

  /** The announced camera, once its video has arrived. */
  get camera(): VoiceCamera | null {
    const id = this.cameraId;
    const stream = id === null ? undefined : this.video.get(id);
    if (id === null || !stream) return null;
    return { streamId: id, stream };
  }

  private clearScreen(): void {
    const id = this.screenId;
    if (id === null) return;
    this.screenId = null;
    this.video.delete(id);
    this.videoIds.delete(id);
    // The share's sound goes with it.
    this.audio.delete(id);
    this.soundIds.delete(id);
  }

  private clearCamera(): void {
    const id = this.cameraId;
    if (id === null) return;
    this.cameraId = null;
    this.video.delete(id);
    this.videoIds.delete(id);
    this.soundIds.delete(id);
  }
}
