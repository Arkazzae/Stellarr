import type { Dispatch, RefObject } from "react";

import type { ChatAction } from "./chatStore";

export type ChatDispatch = Dispatch<ChatAction>;

/** Ids of optimistic messages the server has not answered yet. */
export type PendingIds = RefObject<Set<string>>;

/** The newest journal cursor seen for each channel. */
export type SyncCursors = RefObject<Record<string, string>>;

/** How many messages one history request asks for. */
export const PAGE_SIZE = 50;
