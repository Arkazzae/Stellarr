import { vi } from "vitest";

import type {
  MessageDeleted,
  MessageEmbedsUpdate,
  MessageHistoryPage,
  MessageSyncPage,
} from "@/lib/api/types";
import type {
  Attachment,
  ConnectionStatus,
  Message,
  Ports,
  Reaction,
  SendMessage,
  ThreadSummary,
  User,
  UserPreferences,
} from "@/ports";

import { SELF } from "./fakes";
import { message } from "./messages";

/** A set of listeners the test can call, standing in for one realtime event. */
class Topic<Args extends unknown[]> {
  private readonly handlers = new Set<(...args: Args) => void>();

  subscribe = (handler: (...args: Args) => void): (() => void) => {
    this.handlers.add(handler);
    return () => void this.handlers.delete(handler);
  };

  emit(...args: Args): void {
    for (const handler of [...this.handlers]) handler(...args);
  }
}

export function page(
  messages: Message[],
  nextCursor: string | null = null,
  syncCursor = "cursor-1",
): MessageHistoryPage {
  return { messages, nextCursor, syncCursor };
}

export function journal(
  changes: MessageSyncPage["changes"],
  nextCursor: string,
  extra: Partial<MessageSyncPage> = {},
): MessageSyncPage {
  return { changes, nextCursor, hasMore: false, resetRequired: false, ...extra };
}

export function attachment(name: string): Attachment {
  return {
    id: `att-${name}`,
    url: `/files/${name}`,
    name,
    contentType: "text/plain",
    size: 3,
  };
}

export function file(name: string): File {
  return new File(["abc"], name, { type: "text/plain" });
}

/** A promise the test settles by hand, to hold a request in flight. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The slice of the ports the chat provider talks to, with every call a spy and
 * every push event something the test can fire. Calls answer with an empty
 * channel until a test says otherwise.
 */
export function createChatHarness() {
  const topics = {
    message: new Topic<[Message]>(),
    updated: new Topic<[Message]>(),
    deleted: new Topic<[MessageDeleted]>(),
    embeds: new Topic<[MessageEmbedsUpdate]>(),
    read: new Topic<[string, string]>(),
    typing: new Topic<[string, string[]]>(),
    reactions: new Topic<[string, Reaction[]]>(),
  };

  let status: ConnectionStatus = "idle";
  const statusListeners = new Set<() => void>();
  const reactions = new Map<string, Reaction[]>();

  const chat = {
    listMessages: vi.fn(
      async (
        _channelId: string,
        _options?: { cursor?: string; limit?: number },
      ): Promise<MessageHistoryPage> => page([]),
    ),
    syncMessages: vi.fn(
      async (_channelId: string, after: string): Promise<MessageSyncPage> =>
        journal([], after),
    ),
    listThreads: vi.fn(async (_channelId: string): Promise<ThreadSummary[]> => []),
    getThread: vi.fn(
      async (_channelId: string, _rootId: string): Promise<Message[]> => [],
    ),
    listIndexed: vi.fn(async () => ({ messages: [], nextCursor: null })),
    search: vi.fn(async () => []),
    listPinned: vi.fn(async (_channelId: string): Promise<Message[]> => []),
    send: vi.fn(
      async (input: SendMessage): Promise<Message> =>
        message(`server-${input.clientMessageId}`, 30, {
          channelId: input.channelId,
          author: { id: SELF.id, displayName: SELF.displayName },
          content: input.content,
        }),
    ),
    uploadAttachment: vi.fn(async (upload: File) => attachment(upload.name)),
    focusChannel: vi.fn(async () => {}),
    getReadState: vi.fn((): Record<string, string> => ({})),
    markChannelRead: vi.fn(async () => {}),
    onMessage: topics.message.subscribe,
    onMessageUpdated: topics.updated.subscribe,
    onMessageDeleted: topics.deleted.subscribe,
    onEmbedsUpdated: topics.embeds.subscribe,
    onChannelReadChanged: topics.read.subscribe,
  };

  const messageActions = {
    react: vi.fn(async () => {}),
    unreact: vi.fn(async () => {}),
    edit: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setPinned: vi.fn(async () => {}),
    onReactionsChanged: topics.reactions.subscribe,
    getReactions: (messageId: string): Reaction[] => reactions.get(messageId) ?? [],
    supported: {
      reactions: true,
      replies: true,
      threads: true,
      editing: true,
      deletion: true,
      pins: true,
    },
  };

  const typing = {
    notifyTyping: vi.fn(),
    onTypingChanged: topics.typing.subscribe,
  };

  const connection = {
    getStatus: () => status,
    subscribe: (listener: () => void) => {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
  };

  // The state providers the chat provider reads, as plain mutable records. Each
  // value is created once, since a fresh object every render would re-run the
  // effects that depend on it.
  const session: { user: User | null } = { user: SELF };
  const ui = {
    activeTextChannelId: "ch-general" as string | null,
    selectTextChannel: vi.fn(),
    showChannelPanelTab: vi.fn(),
    closeChannelPanel: vi.fn(),
  };
  const directory = {
    members: [SELF],
    server: { id: "srv", name: "Orbit" },
    textChannels: [{ id: "ch-general", name: "general" }],
  };
  const account = {
    preferences: {
      messageSound: true,
      mentionsOnly: false,
      mutedChannelIds: [],
    } as unknown as UserPreferences,
  };
  const emoji = { byShortcode: new Map<string, string>() };
  const language = { locale: "en" as const, t: (key: string) => key };

  return {
    ports: { chat, messageActions, typing, connection } as unknown as Ports,
    chat,
    messageActions,
    typing,
    session,
    ui,
    directory,
    account,
    emoji,
    language,
    emit: {
      message: (m: Message) => topics.message.emit(m),
      updated: (m: Message) => topics.updated.emit(m),
      deleted: (channelId: string, messageId: string) =>
        topics.deleted.emit({ channelId, messageId }),
      embeds: (update: MessageEmbedsUpdate) => topics.embeds.emit(update),
      readChanged: (channelId: string, lastReadAt: string) =>
        topics.read.emit(channelId, lastReadAt),
      typing: (channelId: string, names: string[]) =>
        topics.typing.emit(channelId, names),
      reactions: (messageId: string, next: Reaction[]) => {
        reactions.set(messageId, next);
        topics.reactions.emit(messageId, next);
      },
    },
    setConnection(next: ConnectionStatus) {
      status = next;
      for (const listener of [...statusListeners]) listener();
    },
  };
}
