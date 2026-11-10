import type { ComposerChip } from "@/components/room/ComposerChips";
import type { Attachment } from "@/ports";

/** Most files one message carries. */
export const MAX_ATTACHMENTS = 10;

/** An attachment queued in the composer, before and after its upload lands. */
export interface PendingChip extends ComposerChip {
  file: File;
  attachment: Attachment | null;
}

/**
 * Chips for the files that still fit under the cap, each already uploading.
 * Ids count up from `firstSeq` so two drops in a row cannot collide.
 */
export function queueFiles(
  files: readonly File[],
  alreadyQueued: number,
  firstSeq: number,
): PendingChip[] {
  const room = Math.max(0, MAX_ATTACHMENTS - alreadyQueued);
  return files.slice(0, room).map((file, index) => ({
    id: `chip-${firstSeq + index}`,
    name: file.name,
    file,
    status: "uploading",
    attachment: null,
  }));
}

function change(
  chips: readonly PendingChip[],
  id: string,
  next: Partial<PendingChip>,
): PendingChip[] {
  return chips.map((chip) => (chip.id === id ? { ...chip, ...next } : chip));
}

export function markUploading(chips: readonly PendingChip[], id: string) {
  return change(chips, id, { status: "uploading", error: undefined, attachment: null });
}

export function markUploaded(
  chips: readonly PendingChip[],
  id: string,
  attachment: Attachment,
) {
  return change(chips, id, { status: "ready", error: undefined, attachment });
}

/** A failed chip stays visible: dropping it would look like a send that lost a file. */
export function markFailed(chips: readonly PendingChip[], id: string, error: string) {
  return change(chips, id, { status: "error", error, attachment: null });
}

export function dropChips(chips: readonly PendingChip[], ids: ReadonlySet<string>) {
  return chips.filter((chip) => !ids.has(chip.id));
}

/** Moves the chip at `from` so it lands at `to`; nothing changes for a bad index. */
export function moveChip(
  chips: PendingChip[],
  from: number,
  to: number,
): PendingChip[] {
  const next = [...chips];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return chips;
  next.splice(to, 0, moved);
  return next;
}

/** A message can only go out once every chip has a server id. */
export function allUploaded(chips: readonly PendingChip[]): boolean {
  return chips.every((chip) => chip.status === "ready");
}

export function uploadedAttachments(chips: readonly PendingChip[]): Attachment[] {
  return chips.flatMap((chip) => (chip.attachment === null ? [] : [chip.attachment]));
}

/** What the composer draws: the file and the server's answer stay behind. */
export function toComposerChips(chips: readonly PendingChip[]): ComposerChip[] {
  return chips.map(({ id, name, status, error }) => ({
    id,
    name,
    status,
    ...(error === undefined ? {} : { error }),
  }));
}
