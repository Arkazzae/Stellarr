"use client";

import { useCallback, useRef } from "react";

import { DropOverlay } from "@/components/room/DropOverlay";
import { MediaViewer } from "@/components/room/MediaViewer";
import { ThreadPanel } from "@/components/room/ThreadPanel";
import { Transcript } from "@/components/room/Transcript";
import { Typing } from "@/components/room/Typing";
import { RoomHeader } from "@/components/shell/RoomHeader";
import {
  useAccount,
  useChat,
  useDirectory,
  useEmoji,
  useLanguage,
  useProfile,
  useSession,
  useUi,
} from "@/state/hooks";

import { ChannelPanelContainer } from "./ChannelPanelContainer";
import { NotificationInboxButton } from "./NotificationInboxContainer";
import { RoomComposer } from "./RoomComposer";
import { useAttachmentViewer } from "./useAttachmentViewer";
import { useChatTranslation } from "./useChatTranslation";
import { useThreadLayout } from "./useThreadLayout";

/**
 * The main column of the server view: the open channel's transcript and
 * composer, with its thread and its materials beside it.
 */
export function RoomContainer() {
  const { textChannels, canManageMessages } = useDirectory();
  const { user } = useSession();
  const ui = useUi();
  const chat = useChat();
  const { emoji: customEmoji } = useEmoji();
  const { t } = useLanguage();
  const { preferences } = useAccount();
  const profile = useProfile();
  const translation = useChatTranslation(chat.channelId);
  const viewer = useAttachmentViewer(user?.id ?? "stellarr");
  const threadLayout = useThreadLayout(chat.thread);

  /*
   * The transcript's "go to this message", lent to the channel panel. Only the
   * transcript can perform the scroll, since it is an index into a windowed
   * list, so it hands the function up. A ref, because taking it must not
   * re-render the room; a message older than the loaded window scrolls nowhere.
   */
  const jump = useRef<((messageId: string) => void) | null>(null);
  const takeJump = useCallback((jumpTo: (messageId: string) => void) => {
    jump.current = jumpTo;
  }, []);
  const jumpToMessage = useCallback((messageId: string) => jump.current?.(messageId), []);

  const activeText = textChannels.find((channel) => channel.id === ui.activeTextChannelId);
  const textName = activeText?.name ?? "";
  const channelPanelOpen = ui.channelPanel !== null;
  const threadPanelOpen = chat.thread !== null;
  const threadRootId = chat.thread?.rootId ?? null;
  const threadExpanded = threadPanelOpen && threadLayout.expanded;

  const composer = (
    <RoomComposer
      key={threadPanelOpen ? `thread-${threadRootId}` : "channel"}
      channelName={textName}
      threadRootId={threadRootId}
    />
  );

  // The two transcripts differ only in what they show; everything a reader can
  // do with a message is the same.
  const messageProps = {
    followOwnSend: chat.ownSendToken,
    support: chat.support,
    translation,
    attachments: viewer.attachments,
    customEmoji,
    // Moderation is separate from channel administration; the server enforces
    // the same effective permission on deletion.
    canModerate: canManageMessages,
    developerMode: preferences.developerMode,
    editing: chat.editing,
    onEditSave: chat.saveEdit,
    onEditCancel: chat.cancelEdit,
    onReact: chat.react,
    onAction: chat.runAction,
    onOpenAuthor: profile.toggle,
  };

  return (
    <main
      className={[
        "room",
        channelPanelOpen && "channel-panel-open",
        threadPanelOpen && "thread-panel-open",
        threadExpanded && "thread-panel-expanded",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <RoomHeader
        view="text"
        title={textName}
        topic={activeText?.topic ?? ""}
        rosterOpen={ui.rosterOpen}
        onToggleRoster={ui.toggleRoster}
        railOpen={ui.railOpen}
        onToggleRail={ui.toggleRail}
        panelOpen={channelPanelOpen}
        onTogglePanel={() => {
          chat.closeThread();
          ui.toggleChannelPanel(ui.channelPanelTab);
        }}
        notifications={<NotificationInboxButton />}
        t={t}
      />

      <div className="room-body">
        <div className="view active">
          <Transcript
            {...messageProps}
            key={chat.channelId ?? "no-channel"}
            sections={chat.sections}
            label={t("room.messagesOn", { channel: textName })}
            loading={chat.loading}
            firstUnreadGroupId={chat.firstUnreadGroupId}
            onLoadOlder={chat.loadOlder}
            hasOlder={chat.hasOlder}
            loadingOlder={chat.loadingOlder}
            onJumpReady={takeJump}
          />
          <Typing names={chat.typingNames} />
          {threadPanelOpen ? null : composer}
        </div>
      </div>

      <ThreadPanel
        {...messageProps}
        // The closed panel stays in the shell for its drawer geometry. A fresh
        // transcript for each thread lets its first alignment to the bottom run
        // against that thread's rows, not the empty list the closed panel held.
        key={threadRootId ?? "closed-thread"}
        open={threadPanelOpen}
        expanded={threadExpanded}
        onExpandedChange={threadLayout.setExpanded}
        onClose={chat.closeThread}
        sections={chat.thread?.sections ?? []}
        label={t("room.thread")}
        composer={threadPanelOpen ? composer : null}
      />

      <ChannelPanelContainer
        open={channelPanelOpen}
        callbacks={viewer.attachments}
        onJump={jumpToMessage}
      />

      <DropOverlay
        channelName={textName}
        enabled={activeText !== undefined}
        onDropFiles={chat.attach}
      />
      <MediaViewer target={viewer.target} onClose={viewer.close} />
    </main>
  );
}
