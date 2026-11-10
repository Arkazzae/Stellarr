import type { ApiClient } from "@/lib/api/client";
import type { Attachment, ChannelId, Message, UserId } from "@/lib/api/types";
import { probeMedia } from "@/lib/media/probe";
import type { RealtimeClient } from "@/lib/realtime/types";
import type { ChatPort, SendMessage, TypingPort } from "@/ports";

import type { ReactionStore } from "./messageActions";
import type { ChannelReadStore } from "./readState";

const NOTHING_TO_STOP = (): void => {};

/**
 * `ChatPort` over the HTTP API and the SignalR hub.
 *
 * Writes go over HTTP because they need a response body and a status code;
 * changes arrive over the hub because they are pushed. Everything that returns
 * messages also hands their reactions to `reactions`, so the transcript can
 * read them from one place whichever request delivered the message.
 */
export function createChatAdapter(
  api: ApiClient,
  realtime: RealtimeClient,
  reactions?: ReactionStore,
  reads?: ChannelReadStore,
): ChatPort {
  const remember = (messages: Message[]): void => reactions?.ingest(messages);
  const stopReadSync =
    reads === undefined
      ? NOTHING_TO_STOP
      : realtime.on("ChannelReadChanged", (update) => reads.apply(update));

  return {
    async listMessages(channelId, options) {
      const page = await api.listMessages(channelId, options);
      remember(page.messages);
      return page;
    },

    async syncMessages(channelId, after) {
      const page = await api.syncMessages(channelId, after);
      remember(page.changes.flatMap(({ message }) => (message === undefined ? [] : [message])));
      return page;
    },

    listThreads: (channelId) => api.listThreads(channelId),

    async getThread(channelId, rootId) {
      const messages = await api.getThread(channelId, rootId);
      remember(messages);
      return messages;
    },

    async listIndexed(channelId, options) {
      const page = await api.listIndexedMessages(channelId, options);
      remember(page.messages);
      return page;
    },

    async search(channelId, query) {
      const messages = await api.searchMessages(channelId, query);
      remember(messages);
      return messages;
    },

    async listPinned(channelId) {
      const messages = await api.listPinnedMessages(channelId);
      remember(messages);
      return messages;
    },

    async send({
      channelId,
      content,
      attachmentIds,
      clientMessageId,
      replyToMessageId,
    }: SendMessage) {
      const message = await api.sendMessage(channelId, {
        content,
        attachmentIds,
        clientMessageId,
        // An older server ignores the field and still delivers the message,
        // which is the right way for a reply to fail.
        ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
      });
      remember([message]);
      return message;
    },

    async uploadAttachment(file, options): Promise<Attachment> {
      const measured = await probeMedia(file);
      return api.uploadAttachment(file, {
        ...measured,
        ...(options?.durationSeconds === undefined
          ? {}
          : { durationSeconds: options.durationSeconds }),
        ...(options?.voiceMessage === true ? { voiceMessage: true } : {}),
      });
    },

    onMessage: (handler) => realtime.on("MessageCreated", handler),
    onMessageUpdated: (handler) => realtime.on("MessageUpdated", handler),
    onMessageDeleted: (handler) => realtime.on("MessageDeleted", handler),
    onEmbedsUpdated: (handler) => realtime.on("MessageEmbedsUpdated", handler),

    focusChannel: (channelId) => realtime.joinChannel(channelId),

    getReadState: () => reads?.snapshot() ?? {},

    async markChannelRead(channelId) {
      reads?.apply(await api.markChannelRead(channelId));
    },

    onChannelReadChanged: (handler) =>
      reads?.subscribe(({ channelId, lastReadAt }) => handler(channelId, lastReadAt)) ??
      NOTHING_TO_STOP,

    dispose: stopReadSync,
  };
}

/** How long a typing notice stays valid, and the minimum gap between two we send. */
const TYPING_WINDOW_MS = 3000;

interface TypingUser {
  displayName: string;
  expire: ReturnType<typeof setTimeout>;
}

/** Short-lived typing state, keyed by channel and user. */
export function createTypingAdapter(realtime: RealtimeClient): TypingPort {
  const listeners = new Set<(channelId: ChannelId, displayNames: string[]) => void>();
  const lastSent = new Map<ChannelId, number>();
  const typing = new Map<ChannelId, Map<UserId, TypingUser>>();

  const announce = (channelId: ChannelId): void => {
    const displayNames = [...(typing.get(channelId)?.values() ?? [])].map(
      ({ displayName }) => displayName,
    );
    for (const listener of listeners) listener(channelId, displayNames);
  };

  const stopListening = realtime.on("TypingChanged", (event) => {
    const lifetime = Date.parse(event.expiresAt) - Date.now();
    if (!Number.isFinite(lifetime) || lifetime <= 0) return;

    const inChannel = typing.get(event.channelId) ?? new Map<UserId, TypingUser>();
    const previous = inChannel.get(event.userId);
    if (previous !== undefined) clearTimeout(previous.expire);
    const expire = setTimeout(() => {
      inChannel.delete(event.userId);
      if (inChannel.size === 0) typing.delete(event.channelId);
      announce(event.channelId);
    }, lifetime);
    inChannel.set(event.userId, { displayName: event.displayName, expire });
    typing.set(event.channelId, inChannel);
    announce(event.channelId);
  });

  return {
    notifyTyping(channelId) {
      const now = Date.now();
      if (now - (lastSent.get(channelId) ?? 0) < TYPING_WINDOW_MS) return;
      lastSent.set(channelId, now);
      // Typing is a hint; a dropped one is not worth surfacing.
      void realtime.sendTyping(channelId).catch(() => undefined);
    },

    onTypingChanged(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    dispose() {
      stopListening();
      for (const inChannel of typing.values()) {
        for (const { expire } of inChannel.values()) clearTimeout(expire);
      }
      typing.clear();
      listeners.clear();
    },
  };
}
