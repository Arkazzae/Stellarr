import { useCallback, useMemo, useState } from "react";

import type { Message, MessageActionsPort } from "@/ports";

import type { ChatDispatch } from "./shared";

/**
 * The message being rewritten, and the text it started with.
 *
 * The composer is the editor: a message becomes editable in the one field that
 * is already there, already grows, already takes Enter to send. A second
 * textarea drawn inside the transcript would be a second implementation of
 * every one of those.
 */
export function useMessageEdit(
  actions: MessageActionsPort,
  messages: Readonly<Record<string, readonly Message[]>>,
  dispatch: ChatDispatch,
) {
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(
    null,
  );

  /**
   * Saves a rewrite. The transcript is updated straight away and rolled back
   * if the server refuses, the same bargain sending makes. A failure leaves
   * the editor open with the text still in it, because the alternative is
   * losing what somebody just wrote.
   */
  const saveEdit = useCallback(
    async (messageId: string, text: string) => {
      const next = text.trim();
      if (next.length === 0) return;

      const before = Object.values(messages)
        .flat()
        .find((message) => message.id === messageId);
      if (before === undefined) return;
      if (next === before.content) {
        setEditing(null);
        return;
      }

      dispatch({
        type: "rewritten",
        channelId: before.channelId,
        messageId,
        content: next,
        editedAt: new Date().toISOString(),
      });
      setEditing(null);

      try {
        await actions.edit(messageId, next);
      } catch (error) {
        dispatch({ type: "shown", message: before });
        setEditing({ id: messageId, original: before.content });
        throw error;
      }
    },
    [actions, messages, dispatch],
  );

  const beginEdit = useCallback(
    (message: Message) =>
      setEditing({ id: message.id, original: message.content }),
    [],
  );

  const cancelEdit = useCallback(() => setEditing(null), []);

  /** A message was deleted: stop editing it. */
  const forgetEdit = useCallback(
    (messageId: string) =>
      setEditing((current) => (current?.id === messageId ? null : current)),
    [],
  );

  return useMemo(
    () => ({ editing, saveEdit, beginEdit, cancelEdit, forgetEdit }),
    [editing, saveEdit, beginEdit, cancelEdit, forgetEdit],
  );
}
