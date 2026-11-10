"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { PinnedMessageVM } from "@/components/room/channelPanelModel";
import type { ComposerChip } from "@/components/room/ComposerChips";
import type { MessageAction } from "@/components/room/MessageToolbar";
import type { TranscriptSectionVM } from "@/components/room/Transcript";
import { buildThreadTranscript, buildTranscript } from "@/lib/format";
import { findFirstUnreadGroup } from "@/lib/unread";
import type {
  Message,
  MessageActionSupport,
  MessageReference,
  ThreadSummary,
} from "@/ports";

import { useAccountContext } from "./AccountProvider";
import { chatReducer, EMPTY_CHAT_DATA } from "./chat/chatStore";
import {
  memberFaces,
  mentionTargets,
  pinnedRows,
  presentTranscript,
  type PresentationContext,
} from "./chat/present";
import type { PendingIds, SyncCursors } from "./chat/shared";
import { NO_MESSAGES } from "./chat/timeline";
import { useAttachmentQueue } from "./chat/useAttachmentQueue";
import { useChannelPages } from "./chat/useChannelPages";
import { useChatComposer } from "./chat/useChatComposer";
import { useChatFeed } from "./chat/useChatFeed";
import { useMessageActions } from "./chat/useMessageActions";
import { useMessageEdit } from "./chat/useMessageEdit";
import { useReadMarks } from "./chat/useReadMarks";
import { useReconnectSync } from "./chat/useReconnectSync";
import { useThreadCatalogue } from "./chat/useThreadCatalogue";
import { useThreadPanel } from "./chat/useThreadPanel";
import { useDirectoryContext } from "./DirectoryProvider";
import { useEmoji } from "./EmojiProvider";
import { useLanguage } from "./LanguageProvider";
import { usePorts } from "./PortsProvider";
import { useSessionContext } from "./SessionProvider";
import { useUiContext } from "./UiProvider";

export interface ChatValue {
  channelId: string | null;
  sections: TranscriptSectionVM[];
  thread: {
    rootId: string;
    sections: TranscriptSectionVM[];
    /** The room applies this once for each new open revision. */
    initialExpanded: boolean;
    openRevision: number;
  } | null;
  /** Complete per-channel catalogues used by the dropdowns in the left rail. */
  threadsByChannel: Readonly<Record<string, ThreadSummary[]>>;
  /** The rail row waiting for its complete conversation read, or null. */
  openingThreadId: string | null;
  /** Changes channel when needed, then opens the complete selected thread. */
  openThread: (thread: ThreadSummary) => void;
  closeThread: () => void;
  /**
   * How many messages have arrived on each channel since you last read it.
   * The channel you are on is always zero: you are reading it now.
   */
  unreadByChannel: Readonly<Record<string, number>>;
  /**
   * Clears one channel's badge without opening it.
   *
   * The same mark that leaving a channel writes, moved forward by hand: reading
   * is how a channel normally becomes read, and this is for the one you have
   * decided not to read.
   */
  markChannelRead: (channelId: string) => void;
  /**
   * The first block of the open channel that arrived after you last left it,
   * or null when there is nothing new. The transcript draws its "new messages"
   * line above this block, and the line stays put while you read: the mark
   * only moves when you leave the channel.
   */
  firstUnreadGroupId: string | null;
  /** True while the first page of a channel is still in flight. */
  loading: boolean;
  /** True while an older page is being prepended. */
  loadingOlder: boolean;
  /** False once the beginning of this channel has been reached. */
  hasOlder: boolean;
  typingNames: string[];
  chips: ComposerChip[];
  support: MessageActionSupport;
  /**
   * The open channel's pinned messages, newest pin first.
   *
   * Read from its own endpoint rather than filtered out of `sections`: a pin is
   * normally far above the loaded window, and a list that filled in as you
   * scrolled would not be a list of the pinned messages.
   */
  pinned: PinnedMessageVM[];
  /** True while that list is in flight for the first time on this channel. */
  pinnedLoading: boolean;
  /** Why the last pin or unpin did not happen, or null. */
  pinError: string | null;
  /** The message the composer is answering, or null when it is not. */
  replyingTo: MessageReference | null;
  /**
   * The message the composer is rewriting, with the text it started with.
   * `send` saves it instead of posting a new message while this is set.
   */
  editing: { id: string; original: string } | null;
  /** Called by the editor in the message. Rejects if the server refuses. */
  saveEdit: (messageId: string, text: string) => Promise<void>;
  cancelEdit: () => void;
  /** Raised by the toolbar's reply action; the composer then names it. */
  startReply: (messageId: string) => void;
  cancelReply: () => void;

  /**
   * Bumped the moment one of your own messages enters the list.
   *
   * The transcript follows arrivals only for a reader already at the end, which
   * is right for someone else's message and wrong for your own: you just
   * acted, so you are owed the result. A token rather than a boolean, because
   * two sends in a row have to be two distinct events.
   */
  ownSendToken: number;
  send: (text: string) => Promise<void>;
  /** Uploads and publishes one standalone recording from the composer. */
  sendVoice: (file: File, durationSeconds: number) => Promise<void>;
  /** Sends one canonical GIPHY page as a standalone message. */
  sendGif: (pageUrl: string) => Promise<void>;
  attach: (files: File[]) => void;
  retryChip: (chipId: string) => void;
  removeChip: (chipId: string) => void;
  reorderChips: (from: number, to: number) => void;
  notifyTyping: () => void;
  loadOlder: () => void;
  react: (messageId: string, emoji: string) => void;
  runAction: (messageId: string, action: MessageAction) => void;
  /** Adds an indexed result to the transcript window so it can be revealed. */
  revealMessage: (message: Message) => void;
}

const ChatContext = createContext<ChatValue | null>(null);

const NO_NAMES: string[] = [];
const NO_PINS: PinnedMessageVM[] = [];

export function ChatProvider({ children }: { children: ReactNode }) {
  const ports = usePorts();
  const { preferences } = useAccountContext();
  const { user } = useSessionContext();
  const { members, server, textChannels } = useDirectoryContext();
  const { byShortcode: customEmoji } = useEmoji();
  const { locale, t } = useLanguage();
  const {
    activeTextChannelId: channelId,
    selectTextChannel,
    showChannelPanelTab,
    closeChannelPanel,
  } = useUiContext();
  const connection = useSyncExternalStore(
    ports.connection.subscribe,
    ports.connection.getStatus,
    ports.connection.getStatus,
  );

  const [data, dispatch] = useReducer(chatReducer, EMPTY_CHAT_DATA);
  const pendingIds: PendingIds = useRef(new Set<string>());
  const syncCursors: SyncCursors = useRef<Record<string, string>>({});

  const textChannelIds = useMemo(
    () => textChannels.map((channel) => channel.id),
    [textChannels],
  );
  const messages =
    channelId === null ? NO_MESSAGES : (data.messages[channelId] ?? NO_MESSAGES);

  const panel = useThreadPanel({
    chat: ports.chat,
    channelId,
    locale,
    messages,
    dispatch,
    selectTextChannel,
    closeChannelPanel,
  });
  const queue = useAttachmentQueue(ports.chat, t);
  const edit = useMessageEdit(ports.messageActions, data.messages, dispatch);
  const composer = useChatComposer({
    chat: ports.chat,
    channelId,
    user,
    dispatch,
    pendingIds,
    pending: queue.pending,
    discardChips: queue.discard,
    replyTarget: panel.replyTarget,
    settleReply: panel.settleReply,
  });

  const { forgetReply, forgetThread } = panel;
  const { forgetEdit } = edit;
  const onRemoved = useCallback(
    (messageId: string) => {
      forgetReply(messageId);
      forgetEdit(messageId);
      forgetThread(messageId);
    },
    [forgetReply, forgetEdit, forgetThread],
  );

  const { typing, reactionEpoch } = useChatFeed({
    ports,
    dispatch,
    locale,
    onRemoved,
    selfId: user?.id ?? null,
    selfUsername: user?.username ?? null,
    openChannelId: channelId,
    preferences,
  });
  useThreadCatalogue(ports.chat, textChannelIds, data.threadsLoaded, dispatch);
  const { loadOlder } = useChannelPages({
    chat: ports.chat,
    channelId,
    data,
    dispatch,
    pendingIds,
    syncCursors,
  });
  useReconnectSync({
    connected: connection === "connected",
    channelIds: textChannelIds,
    chat: ports.chat,
    dispatch,
    pendingIds,
    syncCursors,
    onRemoved,
  });
  const reads = useReadMarks({
    chat: ports.chat,
    channelId,
    messages: data.messages,
    selfId: user?.id,
  });

  const pinnedMessages =
    channelId === null ? NO_MESSAGES : (data.pins[channelId] ?? NO_MESSAGES);
  const pinned = useMemo(
    () => pinnedRows(pinnedMessages, locale, server.name),
    [pinnedMessages, locale, server.name],
  );
  /** Which individual messages carry the pin marker and unpin action. */
  const pinnedIds = useMemo(
    () => new Set(pinnedMessages.map((message) => message.id)),
    [pinnedMessages],
  );

  const faces = useMemo(() => memberFaces(members), [members]);
  const mentions = useMemo(
    () => mentionTargets(members, user?.id),
    [members, user?.id],
  );
  const view = useMemo<PresentationContext>(() => {
    void reactionEpoch; // rebuilt when a reaction changes; read per message
    return {
      selfId: user?.id,
      server,
      faces,
      customEmoji,
      mentions,
      pinnedIds,
      reactionsOf: (messageId) => ports.messageActions.getReactions(messageId),
      extFallback: t("attachment.extFallback"),
    };
  }, [ports, reactionEpoch, user?.id, server, faces, customEmoji, mentions, pinnedIds, t]);

  const sections = useMemo(
    () => presentTranscript(buildTranscript(messages, new Date(), locale), view),
    [messages, locale, view],
  );

  const { threadRootId, threadInitialExpanded, threadOpenRevision } = panel;
  const thread = useMemo(
    () =>
      threadRootId === null
        ? null
        : {
            rootId: threadRootId,
            sections: presentTranscript(
              buildThreadTranscript(messages, threadRootId, new Date(), locale),
              view,
            ),
            initialExpanded: threadInitialExpanded,
            openRevision: threadOpenRevision,
          },
    [messages, locale, view, threadRootId, threadInitialExpanded, threadOpenRevision],
  );

  const firstUnreadGroupId = useMemo(
    () =>
      reads.openMark === null
        ? null
        : findFirstUnreadGroup(
            sections.flatMap((section) => section.groups),
            reads.openMark,
            user?.id,
          ),
    [sections, reads.openMark, user?.id],
  );

  const actions = useMessageActions({
    actions: ports.messageActions,
    t,
    dispatch,
    messages,
    pinnedIds,
    showChannelPanelTab,
    startReply: panel.startReply,
    cancelReply: panel.cancelReply,
    forgetReply,
    showThread: panel.showThread,
    beginEdit: edit.beginEdit,
    forgetEdit,
  });

  const revealMessage = useCallback(
    (message: Message) => dispatch({ type: "shown", message }),
    [],
  );

  const value = useMemo<ChatValue>(
    () => ({
      channelId,
      sections,
      thread,
      threadsByChannel: data.threads,
      openingThreadId: panel.openingThreadId,
      openThread: panel.openThread,
      closeThread: panel.closeThread,
      unreadByChannel: reads.unreadByChannel,
      markChannelRead: reads.markChannelRead,
      firstUnreadGroupId,
      loading: channelId !== null && data.loaded[channelId] !== true,
      loadingOlder: channelId !== null && data.loadingOlder[channelId] === true,
      hasOlder: channelId !== null && typeof data.nextCursor[channelId] === "string",
      typingNames: (channelId === null ? undefined : typing[channelId]) ?? NO_NAMES,
      chips: queue.chips,
      support: ports.messageActions.supported,
      pinned: channelId === null ? NO_PINS : pinned,
      pinnedLoading: channelId !== null && data.pinsLoaded[channelId] !== true,
      pinError: actions.pinError,
      replyingTo: panel.replyingTo,
      editing: edit.editing,
      saveEdit: edit.saveEdit,
      cancelEdit: edit.cancelEdit,
      startReply: panel.startReply,
      cancelReply: panel.cancelReply,
      ownSendToken: composer.ownSendToken,
      send: composer.send,
      sendVoice: composer.sendVoice,
      sendGif: composer.sendGif,
      attach: queue.attach,
      retryChip: queue.retryChip,
      removeChip: queue.removeChip,
      reorderChips: queue.reorderChips,
      notifyTyping: () => {
        if (channelId !== null) ports.typing.notifyTyping(channelId);
      },
      loadOlder,
      react: actions.react,
      runAction: actions.runAction,
      revealMessage,
    }),
    [
      channelId,
      sections,
      thread,
      data,
      panel,
      reads,
      firstUnreadGroupId,
      typing,
      queue,
      ports,
      pinned,
      actions,
      edit,
      composer,
      loadOlder,
      revealMessage,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatValue {
  const value = useContext(ChatContext);
  if (value === null) {
    throw new Error("useChat must be used inside <ChatProvider>");
  }
  return value;
}
