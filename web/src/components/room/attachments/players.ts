/**
 * Where a video embed's player lives.
 *
 * Both decisions here are about the reader, not the poster. Nothing is
 * requested from the provider until the reader presses play: the tile is drawn
 * from what the server already knows, and a page of auto-loaded players would
 * tell YouTube about everyone who scrolled past. And the host is the
 * no-cookie one wherever the provider offers it.
 */

export interface PlayerSource {
  /** The `src` for the iframe; empty when the provider is not supported. */
  url: string;
  /** Whether we know how to frame this provider at all. */
  supported: boolean;
}

export interface PlayerOptions {
  provider: string;
  providerId: string;
  startSeconds?: number;
  /** Autoplay is only ever the result of a click, never of a render. */
  autoplay?: boolean;
}

export function playerSource({
  provider,
  providerId,
  startSeconds,
  autoplay = true,
}: PlayerOptions): PlayerSource {
  const id = encodeURIComponent(providerId);
  const start = startSeconds !== undefined && startSeconds > 0 ? startSeconds : undefined;
  const play = autoplay ? "1" : "0";

  switch (provider) {
    case "youtube": {
      const params = new URLSearchParams({ autoplay: play, rel: "0", playsinline: "1" });
      if (start !== undefined) params.set("start", String(start));
      return {
        url: `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`,
        supported: true,
      };
    }
    case "vimeo": {
      const params = new URLSearchParams({ autoplay: play, dnt: "1" });
      if (start !== undefined) params.set("t", `${start}s`);
      return {
        url: `https://player.vimeo.com/video/${id}?${params.toString()}`,
        supported: true,
      };
    }
    default:
      return { url: "", supported: false };
  }
}

/** How the provider is named to a reader, rather than to a parser. */
export function providerLabel(provider: string): string {
  switch (provider) {
    case "youtube":
      return "YouTube";
    case "vimeo":
      return "Vimeo";
    default:
      return provider;
  }
}
