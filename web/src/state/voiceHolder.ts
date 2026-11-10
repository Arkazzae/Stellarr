import { IDLE_VOICE_STATE, type VoiceClient, type VoiceState } from "@/lib/voice/types";

/**
 * Holds whichever voice client is currently live and republishes its snapshot
 * to React through `useSyncExternalStore`.
 *
 * It lives outside React so the client can be created inside the effect that
 * disposes it. StrictMode mounts, cleans up and remounts every effect; a client
 * created during render would be disposed by the first cleanup and stay dead
 * for the rest of the session.
 */
export class VoiceHolder {
  #client: VoiceClient | null = null;
  #unsubscribe: (() => void) | null = null;
  #state: VoiceState = IDLE_VOICE_STATE;
  #startedAt: number | null = null;
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getState = (): VoiceState => this.#state;

  /**
   * When the current call began, in epoch ms, or null when there is none.
   *
   * The clock is read here, at the transition the client reports, rather than
   * during a render, so a re-render can never move the dock's counter.
   */
  getStartedAt = (): number | null => this.#startedAt;

  getClient = (): VoiceClient | null => this.#client;

  attach(client: VoiceClient): void {
    this.detach();
    this.#client = client;
    this.#take(client.getSnapshot());
    this.#unsubscribe = client.subscribe(() => {
      this.#take(client.getSnapshot());
      this.#notify();
    });
    this.#notify();
  }

  detach(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    const previous = this.#client;
    this.#client = null;
    this.#take(IDLE_VOICE_STATE);
    previous?.dispose();
    this.#notify();
  }

  // The counter follows the client, not the click: a join that fails or is
  // retried must not leave a timer running behind a dock that is not there.
  #take(next: VoiceState): void {
    if (next.channelId !== this.#state.channelId) {
      this.#startedAt = next.channelId === null ? null : Date.now();
    }
    this.#state = next;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}
