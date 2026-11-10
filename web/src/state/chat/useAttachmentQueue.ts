import { useCallback, useMemo, useRef, useState } from "react";

import { describeError } from "@/lib/api/errors";
import type { Translator } from "@/i18n";
import type { ChatPort } from "@/ports";

import {
  dropChips,
  markFailed,
  markUploaded,
  markUploading,
  moveChip,
  queueFiles,
  toComposerChips,
  type PendingChip,
} from "./pendingChips";

/**
 * The files waiting to go out with the next message.
 *
 * Each uploads as soon as it is added, and the composer keeps send disabled
 * until every chip has a real server id, so a message can never outrun its
 * media upload.
 */
export function useAttachmentQueue(chat: ChatPort, t: Translator) {
  const [pending, setPending] = useState<PendingChip[]>([]);
  /** Local ids for chips, so two drops in a row cannot collide. */
  const lastSeq = useRef(0);

  const upload = useCallback(
    (id: string, file: File) => {
      setPending((current) => markUploading(current, id));
      void chat
        .uploadAttachment(file)
        .then((attachment) => {
          setPending((current) => markUploaded(current, id, attachment));
        })
        .catch((error: unknown) => {
          const reason = describeError(error, t("composer.attachmentUploadFailed"), t);
          setPending((current) => markFailed(current, id, reason));
        });
    },
    [chat, t],
  );

  const attach = useCallback(
    (files: File[]) => {
      const queued = queueFiles(files, pending.length, lastSeq.current + 1);
      lastSeq.current += queued.length;
      setPending((current) => [...current, ...queued]);
      for (const chip of queued) upload(chip.id, chip.file);
    },
    [pending.length, upload],
  );

  const retryChip = useCallback(
    (chipId: string) => {
      const failed = pending.find(
        (chip) => chip.id === chipId && chip.status === "error",
      );
      if (failed !== undefined) upload(failed.id, failed.file);
    },
    [pending, upload],
  );

  /** Forgets chips whose message went out. */
  const discard = useCallback(
    (ids: ReadonlySet<string>) => setPending((current) => dropChips(current, ids)),
    [],
  );

  const removeChip = useCallback(
    (chipId: string) => discard(new Set([chipId])),
    [discard],
  );

  const reorderChips = useCallback(
    (from: number, to: number) =>
      setPending((current) => moveChip(current, from, to)),
    [],
  );

  const chips = useMemo(() => toComposerChips(pending), [pending]);

  return useMemo(
    () => ({ pending, chips, attach, retryChip, removeChip, reorderChips, discard }),
    [pending, chips, attach, retryChip, removeChip, reorderChips, discard],
  );
}
