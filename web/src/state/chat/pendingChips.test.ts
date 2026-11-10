import { describe, expect, it } from "vitest";

import type { Attachment } from "@/ports";

import {
  MAX_ATTACHMENTS,
  allUploaded,
  dropChips,
  markFailed,
  markUploaded,
  markUploading,
  moveChip,
  queueFiles,
  toComposerChips,
  uploadedAttachments,
  type PendingChip,
} from "./pendingChips";

const file = (name: string) => new File(["x"], name, { type: "text/plain" });
const attachment = (id: string): Attachment => ({
  id,
  url: `/files/${id}`,
  name: id,
  contentType: "text/plain",
  size: 1,
});
const names = (chips: readonly { name: string }[]) => chips.map((chip) => chip.name);

describe("queueFiles", () => {
  it("queues each file as an uploading chip with its own id", () => {
    const chips = queueFiles([file("a.txt"), file("b.txt")], 0, 4);
    expect(chips.map((chip) => [chip.id, chip.name, chip.status, chip.attachment])).toEqual([
      ["chip-4", "a.txt", "uploading", null],
      ["chip-5", "b.txt", "uploading", null],
    ]);
  });

  it("takes only as many files as still fit under the cap", () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`f${i}`));
    expect(queueFiles(files, MAX_ATTACHMENTS - 2, 1)).toHaveLength(2);
    expect(queueFiles(files, MAX_ATTACHMENTS, 1)).toEqual([]);
    expect(queueFiles(files, MAX_ATTACHMENTS + 3, 1)).toEqual([]);
  });
});

describe("upload transitions", () => {
  const queued = queueFiles([file("a"), file("b")], 0, 1);

  it("marks only the named chip as uploaded", () => {
    const next = markUploaded(queued, "chip-1", attachment("att-1"));
    expect(next.map((chip) => chip.status)).toEqual(["ready", "uploading"]);
    expect(next[0]?.attachment?.id).toBe("att-1");
  });

  it("keeps a failed chip, with the reason, until it is retried", () => {
    const failed = markFailed(queued, "chip-2", "too large");
    expect(failed[1]).toMatchObject({ status: "error", error: "too large", attachment: null });

    const retried = markUploading(failed, "chip-2");
    expect(retried[1]).toMatchObject({ status: "uploading", attachment: null });
    expect(retried[1]?.error).toBeUndefined();
  });

  it("clears an old error when an upload then succeeds", () => {
    const failed = markFailed(queued, "chip-1", "boom");
    const done = markUploaded(markUploading(failed, "chip-1"), "chip-1", attachment("a1"));
    expect(toComposerChips(done)[0]).toEqual({ id: "chip-1", name: "a", status: "ready" });
  });

  it("does not change its input", () => {
    markUploaded(queued, "chip-1", attachment("att-1"));
    expect(queued[0]?.status).toBe("uploading");
  });
});

describe("sending readiness", () => {
  it("is ready only when every chip has uploaded", () => {
    const queued = queueFiles([file("a"), file("b")], 0, 1);
    expect(allUploaded([])).toBe(true);
    expect(allUploaded(queued)).toBe(false);
    const one = markUploaded(queued, "chip-1", attachment("a1"));
    expect(allUploaded(one)).toBe(false);
    const both = markUploaded(one, "chip-2", attachment("a2"));
    expect(allUploaded(both)).toBe(true);
    expect(uploadedAttachments(both).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("collects only the attachments that exist", () => {
    const queued = queueFiles([file("a"), file("b")], 0, 1);
    expect(uploadedAttachments(markUploaded(queued, "chip-2", attachment("a2"))).map((a) => a.id))
      .toEqual(["a2"]);
  });
});

describe("dropChips and moveChip", () => {
  const chips: PendingChip[] = queueFiles([file("a"), file("b"), file("c")], 0, 1);

  it("drops the chips that were sent and keeps the rest", () => {
    expect(names(dropChips(chips, new Set(["chip-1", "chip-3"])))).toEqual(["b"]);
  });

  it("moves a chip to its new place", () => {
    expect(names(moveChip(chips, 0, 2))).toEqual(["b", "c", "a"]);
    expect(names(moveChip(chips, 2, 0))).toEqual(["c", "a", "b"]);
  });

  it("leaves the order alone for a position that holds nothing", () => {
    expect(moveChip(chips, 7, 0)).toBe(chips);
  });
});

describe("toComposerChips", () => {
  it("hands the composer only what it draws", () => {
    const chips = markFailed(queueFiles([file("a")], 0, 1), "chip-1", "nope");
    expect(toComposerChips(chips)).toEqual([
      { id: "chip-1", name: "a", status: "error", error: "nope" },
    ]);
  });
});
