import type { ApiClient } from "@/lib/api/client";
import type {
  Message,
  MessageId,
  MessageReaction,
  MessageReactionChanged,
  UserId,
} from "@/lib/api/types";
import type { RealtimeClient } from "@/lib/realtime/types";
import type { MessageActionsPort, Reaction, Unsubscribe } from "@/ports";

type ReactionHandler = (messageId: MessageId, reactions: Reaction[]) => void;

const copyAll = (reactions: MessageReaction[]): MessageReaction[] =>
  reactions.map((reaction) => ({ ...reaction }));

/**
 * The reactions every message currently has, fed by history pages and by hub
 * aggregates. Whichever arrives first for a message is kept as the baseline.
 */
export class ReactionStore {
  readonly #byMessage = new Map<MessageId, MessageReaction[]>();
  readonly #handlers = new Set<ReactionHandler>();
  #selfUserId: UserId | undefined;

  setSelfUserId(userId: UserId): void {
    this.#selfUserId = userId;
  }

  /** Records reactions of messages not seen before; known messages keep theirs. */
  ingest(messages: Message[]): void {
    for (const message of messages) {
      // A hub aggregate can beat the history request that returns the same
      // message. It is newer than the page, so the page must not replace it.
      if (this.#byMessage.has(message.id)) continue;
      this.#byMessage.set(message.id, copyAll(message.reactions ?? []));
    }
  }

  get(messageId: MessageId): MessageReaction[] {
    return copyAll(this.#byMessage.get(messageId) ?? []);
  }

  subscribe(handler: ReactionHandler): Unsubscribe {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /**
   * Applies a per-emoji aggregate. The hub says who changed it but not who else
   * reacted, so `mine` follows the update only when it is about the signed-in
   * user. An aggregate that changes nothing is not announced.
   */
  apply(update: MessageReactionChanged): void {
    const current = this.#byMessage.get(update.messageId) ?? [];
    const existing = current.find((reaction) => reaction.emoji === update.emoji);
    const mine =
      update.userId === this.#selfUserId ? update.added : (existing?.mine ?? false);

    const unchanged =
      existing === undefined
        ? update.count === 0
        : existing.count === update.count && existing.mine === mine;
    if (unchanged) return;

    const others = current.filter((reaction) => reaction.emoji !== update.emoji);
    const next =
      update.count > 0
        ? [...others, { emoji: update.emoji, count: update.count, mine }]
        : others;
    this.#byMessage.set(update.messageId, next);
    for (const handler of this.#handlers) handler(update.messageId, copyAll(next));
  }

  reset(): void {
    this.#byMessage.clear();
    this.#selfUserId = undefined;
  }
}

/**
 * `MessageActionsPort` over HTTP, with reaction state shared with the hub.
 *
 * Edits, deletions and pins need no local state: the hub echoes them to every
 * client through the message events the chat adapter already forwards.
 */
export function createMessageActionsAdapter(
  api: ApiClient,
  realtime: RealtimeClient,
  store: ReactionStore,
): MessageActionsPort {
  const stopListening = realtime.on("MessageReactionChanged", (update) => {
    store.apply(update);
  });

  return {
    supported: {
      reactions: true,
      replies: true,
      threads: true,
      editing: true,
      deletion: true,
      pins: true,
    },

    getReactions: (messageId) => store.get(messageId),
    onReactionsChanged: (handler) => store.subscribe(handler),

    async react(messageId, emoji) {
      store.apply(await api.setMessageReaction(messageId, emoji, true));
    },

    async unreact(messageId, emoji) {
      store.apply(await api.setMessageReaction(messageId, emoji, false));
    },

    async edit(messageId, content) {
      await api.editMessage(messageId, content);
    },

    async remove(messageId) {
      await api.deleteMessage(messageId);
    },

    async setPinned(messageId, pinned) {
      await api.setMessagePinned(messageId, pinned);
    },

    dispose: stopListening,
  };
}
