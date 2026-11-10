import type { InterfaceLocale } from "@/i18n";
import type {
  Message,
  MessageEmbed,
  MessageSyncChange,
  ThreadSummary,
} from "@/ports";

import { applyPinChanges, applyPinEcho, sortPins } from "./pins";
import {
  addThreadReply,
  isReply,
  retitleRoot,
  sortThreads,
} from "./threads";
import {
  applySyncChanges,
  mergeAll,
  mergeMessage,
  reconcileLatest,
  removeMessage,
  resetWindow,
  settleOptimistic,
  updateLoaded,
} from "./timeline";

/** What the server has told this tab about every channel it has looked at. */
export interface ChatData {
  messages: Readonly<Record<string, Message[]>>;
  /** The newest page has settled, whether it loaded or failed. */
  loaded: Readonly<Record<string, boolean>>;
  /** Token for the next older page; null at the beginning of the channel. */
  nextCursor: Readonly<Record<string, string | null>>;
  loadingOlder: Readonly<Record<string, boolean>>;
  /**
   * Whole messages rather than ids: a pin is normally far above the loaded
   * window, so resolving ids against `messages` would list only the pins that
   * happen to be on screen.
   */
  pins: Readonly<Record<string, Message[]>>;
  pinsLoaded: Readonly<Record<string, boolean>>;
  threads: Readonly<Record<string, ThreadSummary[]>>;
  threadsLoaded: Readonly<Record<string, boolean>>;
}

export const EMPTY_CHAT_DATA: ChatData = {
  messages: {},
  loaded: {},
  nextCursor: {},
  loadingOlder: {},
  pins: {},
  pinsLoaded: {},
  threads: {},
  threadsLoaded: {},
};

/** A history page, whatever endpoint produced it. */
export interface LoadedPage {
  messages: readonly Message[];
  nextCursor: string | null;
}

export type ChatAction =
  /** A message to show that is not news: an optimistic send, a search hit, a rollback. */
  | { type: "shown"; message: Message }
  /** A message pushed by the server. Replies also count on their thread. */
  | { type: "received"; message: Message }
  | { type: "updated"; message: Message; locale: InterfaceLocale }
  | { type: "deleted"; channelId: string; messageId: string }
  | {
      type: "embeds";
      channelId: string;
      messageId: string;
      embeds: MessageEmbed[];
    }
  | {
      type: "first-page";
      channelId: string;
      page: LoadedPage;
      pendingIds: ReadonlySet<string>;
    }
  | { type: "first-page-failed"; channelId: string }
  | { type: "older-loading"; channelId: string; loading: boolean }
  | { type: "older-page"; channelId: string; page: LoadedPage }
  | {
      type: "reset";
      channelId: string;
      page: LoadedPage;
      pendingIds: ReadonlySet<string>;
    }
  | { type: "synced"; channelId: string; changes: readonly MessageSyncChange[] }
  | { type: "pins-set"; channelId: string; messages: readonly Message[] }
  | { type: "pins-settled"; channelId: string }
  | { type: "threads-set"; channelId: string; threads: readonly ThreadSummary[] }
  | { type: "threads-settled"; channelId: string }
  | { type: "thread-opened"; channelId: string; messages: readonly Message[] }
  /** The server answered a send: its copy replaces the placeholder. */
  | { type: "settled"; channelId: string; placeholderId: string; message: Message }
  /** A message leaves the transcript before, or without, the server being asked. */
  | { type: "dropped"; channelId: string; messageId: string }
  | {
      type: "rewritten";
      channelId: string;
      messageId: string;
      content: string;
      editedAt: string;
    };

type Keyed<T> = Readonly<Record<string, T>>;

function put<T>(record: Keyed<T>, key: string, value: T): Keyed<T> {
  return record[key] === value ? record : { ...record, [key]: value };
}

/** Changes an entry that exists; a channel nobody has loaded is left alone. */
function edit<T>(record: Keyed<T>, key: string, change: (value: T) => T): Keyed<T> {
  const current = record[key];
  return current === undefined ? record : put(record, key, change(current));
}

/** The same state, not a copy of it, when nothing in `changes` is new. */
function patch(state: ChatData, changes: Partial<ChatData>): ChatData {
  const keys = Object.keys(changes) as (keyof ChatData)[];
  return keys.some((key) => changes[key] !== state[key])
    ? { ...state, ...changes }
    : state;
}

export function chatReducer(state: ChatData, action: ChatAction): ChatData {
  switch (action.type) {
    case "shown": {
      const { channelId } = action.message;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          mergeMessage(state.messages[channelId], action.message),
        ),
      });
    }
    case "received": {
      const { message } = action;
      const { channelId } = message;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          mergeMessage(state.messages[channelId], message),
        ),
        threads: isReply(message)
          ? put(
              state.threads,
              channelId,
              addThreadReply(state.threads[channelId], message),
            )
          : state.threads,
      });
    }
    case "updated": {
      const { message, locale } = action;
      const { channelId } = message;
      return patch(state, {
        messages: edit(state.messages, channelId, (bucket) =>
          updateLoaded(bucket, message.id, () => message)),
        pins: edit(state.pins, channelId, (pins) => applyPinEcho(pins, message)),
        threads: edit(state.threads, channelId, (threads) =>
          retitleRoot(threads, message, locale)),
      });
    }
    case "deleted": {
      const { channelId, messageId } = action;
      return patch(state, {
        messages: edit(state.messages, channelId, (bucket) =>
          removeMessage(bucket, messageId)),
        pins: edit(state.pins, channelId, (pins) => removeMessage(pins, messageId)),
      });
    }
    case "embeds": {
      const { channelId, messageId, embeds } = action;
      return patch(state, {
        messages: edit(state.messages, channelId, (bucket) =>
          updateLoaded(bucket, messageId, (message) => ({ ...message, embeds }))),
      });
    }
    case "first-page": {
      const { channelId, page, pendingIds } = action;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          reconcileLatest(state.messages[channelId], page.messages, pendingIds),
        ),
        nextCursor: put(state.nextCursor, channelId, page.nextCursor),
        loaded: put(state.loaded, channelId, true),
      });
    }
    case "first-page-failed":
      return patch(state, {
        nextCursor: put(state.nextCursor, action.channelId, null),
        loaded: put(state.loaded, action.channelId, true),
      });
    case "older-loading":
      return patch(state, {
        loadingOlder: put(state.loadingOlder, action.channelId, action.loading),
      });
    case "older-page": {
      const { channelId, page } = action;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          mergeAll(state.messages[channelId], page.messages),
        ),
        nextCursor: put(state.nextCursor, channelId, page.nextCursor),
      });
    }
    case "reset": {
      const { channelId, page, pendingIds } = action;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          resetWindow(state.messages[channelId], page.messages, pendingIds),
        ),
        nextCursor: put(state.nextCursor, channelId, page.nextCursor),
      });
    }
    case "synced": {
      const { channelId, changes } = action;
      if (changes.length === 0) return state;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          applySyncChanges(state.messages[channelId], changes),
        ),
        pins: edit(state.pins, channelId, (pins) => applyPinChanges(pins, changes)),
      });
    }
    case "pins-set":
      return patch(state, {
        pins: put(state.pins, action.channelId, sortPins(action.messages)),
      });
    case "pins-settled":
      return patch(state, {
        pinsLoaded: put(state.pinsLoaded, action.channelId, true),
      });
    case "threads-set":
      return patch(state, {
        threads: put(state.threads, action.channelId, sortThreads(action.threads)),
      });
    case "threads-settled":
      return patch(state, {
        threadsLoaded: put(state.threadsLoaded, action.channelId, true),
      });
    case "thread-opened": {
      const { channelId, messages } = action;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          mergeAll(state.messages[channelId], messages),
        ),
      });
    }
    case "settled": {
      const { channelId, placeholderId, message } = action;
      return patch(state, {
        messages: put(
          state.messages,
          channelId,
          settleOptimistic(state.messages[channelId], placeholderId, message),
        ),
      });
    }
    case "dropped": {
      const { channelId, messageId } = action;
      return patch(state, {
        messages: edit(state.messages, channelId, (bucket) =>
          removeMessage(bucket, messageId)),
      });
    }
    case "rewritten": {
      const { channelId, messageId, content, editedAt } = action;
      return patch(state, {
        messages: edit(state.messages, channelId, (bucket) =>
          updateLoaded(bucket, messageId, (message) => ({
            ...message,
            content,
            editedAt,
          }))),
      });
    }
  }
}
