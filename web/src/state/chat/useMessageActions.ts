import { useCallback, useMemo, useState } from "react";

import type { ChannelPanelTab } from "@/components/room/channelPanelModel";
import type { MessageAction } from "@/components/room/MessageToolbar";
import type { Translator } from "@/i18n";
import { describeError } from "@/lib/api/errors";
import type { Message, MessageActionsPort } from "@/ports";

import type { ChatDispatch } from "./shared";

interface MessageActionsOptions {
  actions: MessageActionsPort;
  t: Translator;
  dispatch: ChatDispatch;
  /** The open channel's loaded messages. */
  messages: readonly Message[];
  pinnedIds: ReadonlySet<string>;
  showChannelPanelTab: (tab: ChannelPanelTab) => void;
  startReply: (messageId: string) => void;
  cancelReply: () => void;
  forgetReply: (messageId: string) => void;
  showThread: (messageId: string) => void;
  beginEdit: (message: Message) => void;
  forgetEdit: (messageId: string) => void;
}

/** What the toolbar and the context menu do to a message. */
export function useMessageActions({
  actions,
  t,
  dispatch,
  messages,
  pinnedIds,
  showChannelPanelTab,
  startReply,
  cancelReply,
  forgetReply,
  showThread,
  beginEdit,
  forgetEdit,
}: MessageActionsOptions) {
  /** Why the last pin or unpin did not happen; the pinned list says it. */
  const [pinError, setPinError] = useState<string | null>(null);

  const react = useCallback(
    (messageId: string, emoji: string) => {
      const mine = actions
        .getReactions(messageId)
        .some((reaction) => reaction.emoji === emoji && reaction.mine);
      void (mine ? actions.unreact(messageId, emoji) : actions.react(messageId, emoji));
    },
    [actions],
  );

  const runAction = useCallback(
    (messageId: string, action: MessageAction) => {
      switch (action) {
        case "reply":
          startReply(messageId);
          return;
        case "thread":
          showThread(messageId);
          return;
        case "edit": {
          // Arms the composer with the old body; saving is what calls the
          // port. Answering and editing are the same field, so starting one
          // ends the other.
          const target = messages.find((message) => message.id === messageId);
          if (target === undefined) return;
          cancelReply();
          beginEdit(target);
          return;
        }
        case "pin":
          // One control, both directions: the toolbar and the menu label it
          // from the same fact this reads. No optimistic move: the server can
          // refuse for ordinary reasons (no permission, the channel at its
          // ceiling), so the echo is what moves the list.
          setPinError(null);
          void actions
            .setPinned(messageId, !pinnedIds.has(messageId))
            .catch((cause: unknown) => {
              // Nothing moved, so something has to say why. The pinned list is
              // where the outcome belongs, and it is opened here because a
              // refusal nobody sees is the same as a control that did nothing.
              setPinError(describeError(cause, t("message.pinFailed"), t));
              showChannelPanelTab("pinned");
            });
          return;
        case "delete": {
          // Removed from this transcript straight away and put back if the
          // server refuses: the person who pressed it is watching the
          // message, not a spinner.
          const target = messages.find((message) => message.id === messageId);
          if (target === undefined) return;
          dispatch({ type: "dropped", channelId: target.channelId, messageId });
          forgetReply(messageId);
          forgetEdit(messageId);
          void actions.remove(messageId).catch(() => {
            dispatch({ type: "shown", message: target });
          });
        }
      }
    },
    [
      actions,
      t,
      dispatch,
      messages,
      pinnedIds,
      showChannelPanelTab,
      startReply,
      cancelReply,
      forgetReply,
      showThread,
      beginEdit,
      forgetEdit,
    ],
  );

  return useMemo(
    () => ({ pinError, react, runAction }),
    [pinError, react, runAction],
  );
}
