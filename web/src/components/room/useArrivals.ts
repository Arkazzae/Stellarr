import { useEffect, useState } from "react";

/** How long a new block counts as just arrived. */
const FRESH_MS = 400;

/**
 * What the end of the transcript is doing, from the point of view of the
 * reader's attention.
 *
 * `freshId` is the block that has just arrived. Its attachments load eagerly
 * for one short window; a windowed list also remounts old blocks while
 * scrolling, so the last row changing identity is what tells a real arrival
 * apart. Nothing is fresh on the first render: opening a channel is not an
 * arrival.
 *
 * `missed` is true once something landed while the reader was away from the
 * end, and clears when they get back. It is what turns the way-back-down arrow
 * into a named pill.
 *
 * Both are adjusted during render rather than kept in refs, so the server
 * render and the hydrating render agree on every class name.
 */
export function useArrivals(lastRowId: string | undefined, atBottom: boolean) {
  const [seen, setSeen] = useState({ last: lastRowId, fresh: undefined as string | undefined });
  const [missed, setMissed] = useState(false);

  if (seen.last !== lastRowId) {
    setSeen({ last: lastRowId, fresh: lastRowId });
    // A first row appearing in an empty transcript is a load, not an arrival.
    if (!atBottom && seen.last !== undefined && lastRowId !== undefined) {
      setMissed(true);
    }
  }
  if (atBottom && missed) setMissed(false);

  useEffect(() => {
    if (seen.fresh === undefined) return;
    const timer = window.setTimeout(
      () => setSeen((current) => ({ ...current, fresh: undefined })),
      FRESH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [seen.fresh]);

  return {
    freshId: seen.fresh,
    missed,
    dismissMissed: () => setMissed(false),
  };
}
