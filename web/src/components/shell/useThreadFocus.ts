import { useCallback, useEffect, useRef } from "react";

import type { RailThreads } from "@/components/shell/railTypes";

/**
 * Keeps keyboard focus on the thread button the visual selection names.
 *
 * A thread opened from a message never went through its channel's toggle, so
 * the rail opens the list itself and focus has to follow. The effect belongs
 * to the rail rather than to each thread list: a channel moved to another
 * section remounts its list, and that must not pull focus back onto the
 * thread from wherever it was. It runs only when the active thread, the
 * channel that holds it, or `hidden` changes. A closed mobile drawer is never
 * a focus destination.
 *
 * Returns the callback the thread buttons register themselves with.
 */
export function useThreadFocus(
  byChannel: RailThreads["byChannel"],
  activeId: string | null,
  hidden: boolean,
): RailThreads["register"] {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const holderId =
    activeId === null
      ? null
      : (Object.entries(byChannel).find(([, threads]) =>
          threads.some((thread) => thread.id === activeId),
        )?.[0] ?? null);

  useEffect(() => {
    if (hidden || activeId === null || holderId === null) return;
    buttons.current.get(activeId)?.focus();
  }, [holderId, activeId, hidden]);

  return useCallback((threadId, button) => {
    if (button === null) buttons.current.delete(threadId);
    else buttons.current.set(threadId, button);
  }, []);
}
