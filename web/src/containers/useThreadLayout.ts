"use client";

import { useState } from "react";

import type { ChatValue } from "@/state/hooks";

/**
 * Whether the open thread spans the room or sits beside it.
 *
 * Every opening of a thread starts from the layout its opener asked for (a
 * thread opened from the rail is wide, one opened from a message is not), and
 * the reader's own choice then holds until the next opening.
 */
export function useThreadLayout(thread: ChatValue["thread"]) {
  const revision = thread?.openRevision ?? -1;
  const initial = thread?.initialExpanded ?? false;
  const [layout, setLayout] = useState({ revision: -1, expanded: false });

  // Adjusted during render, React's escape hatch for state derived from
  // props, so a newly opened thread never paints once in the previous layout.
  if (layout.revision !== revision) setLayout({ revision, expanded: initial });

  return {
    expanded: layout.revision === revision ? layout.expanded : initial,
    setExpanded: (expanded: boolean) => setLayout({ revision, expanded }),
  };
}
