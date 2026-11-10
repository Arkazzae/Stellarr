import type { ChannelId, ChannelReadChanged } from "@/lib/api/types";
import type { Unsubscribe } from "@/ports";

type Handler = (update: ChannelReadChanged) => void;

/** The signed-in user's read watermark per channel, shared by every tab's updates. */
export class ChannelReadStore {
  #watermarks: Record<ChannelId, string> = {};
  readonly #handlers = new Set<Handler>();

  hydrate(reads: Record<ChannelId, string> | undefined): void {
    this.#watermarks = { ...reads };
  }

  snapshot(): Readonly<Record<ChannelId, string>> {
    return this.#watermarks;
  }

  /** A watermark never moves backwards, and an update that changes nothing is not announced. */
  apply(update: ChannelReadChanged): void {
    const current = this.#watermarks[update.channelId];
    if (current !== undefined && Date.parse(current) >= Date.parse(update.lastReadAt)) return;
    this.#watermarks = { ...this.#watermarks, [update.channelId]: update.lastReadAt };
    for (const handler of this.#handlers) handler(update);
  }

  subscribe(handler: Handler): Unsubscribe {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  reset(): void {
    this.#watermarks = {};
  }
}
