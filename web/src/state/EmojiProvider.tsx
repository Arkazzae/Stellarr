"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { CustomEmoji } from "@/ports";

import { useRuntime } from "./PortsProvider";

export interface EmojiValue {
  /** The server's own emoji, in the order the server lists them. */
  emoji: readonly CustomEmoji[];
  /** Shortcode (without colons) to image URL, for the message parser. */
  byShortcode: ReadonlyMap<string, string>;
  /** Reloads the shared list after an administrative change. */
  refresh: () => Promise<void>;
}

const EmojiContext = createContext<EmojiValue | null>(null);

const NO_EMOJI: EmojiValue = {
  emoji: [],
  byShortcode: new Map(),
  refresh: async () => {},
};

/**
 * The server's custom emoji, loaded once for everyone who needs them.
 *
 * The picker offers them, the transcript resolves `:code:` against them and the
 * reaction bar sends whichever was picked, so the three have to read one list:
 * two lists could render an emoji that the picker cannot produce.
 *
 * A failure is silent and total. Without custom emoji everything else works and
 * `:code:` stays the text somebody typed, and there is nothing useful to tell a
 * reader about a decoration that did not load.
 */
export function EmojiProvider({ children }: { children: ReactNode }) {
  const { ports, realtime } = useRuntime();
  const [emoji, setEmoji] = useState<readonly CustomEmoji[]>([]);

  const refresh = useCallback(async () => {
    setEmoji(await ports.admin.listEmoji());
  }, [ports]);

  useEffect(() => {
    let active = true;
    const load = () => {
      ports.admin
        .listEmoji()
        .then((list) => {
          if (active) setEmoji(list);
        })
        .catch(() => {
          // The instance may lack the endpoint, or the right to read it.
        });
    };
    load();
    const unsubscribe = realtime.on("EmojiChanged", load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ports, realtime]);

  const value = useMemo<EmojiValue>(
    () => ({
      emoji,
      byShortcode: new Map(
        emoji.map((item) => [item.shortcode.replace(/^:|:$/g, ""), item.glyph]),
      ),
      refresh,
    }),
    [emoji, refresh],
  );

  return <EmojiContext.Provider value={value}>{children}</EmojiContext.Provider>;
}

/**
 * An empty set outside the provider, not an error.
 *
 * Unlike the other contexts, nothing here is needed to render a message: a
 * transcript without custom emoji is a correct transcript. Tests and previews
 * mount parts of the room without the whole stack and should not have to know
 * that emoji exist.
 */
export function useEmoji(): EmojiValue {
  return useContext(EmojiContext) ?? NO_EMOJI;
}
