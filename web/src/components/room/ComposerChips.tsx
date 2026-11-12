"use client";

import { useState, type DragEvent } from "react";

import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/hooks";

import { fileExt } from "./parts";

export interface ComposerChip {
  id: string;
  name: string;
  status: "uploading" | "ready" | "error";
  /** Shown instead of the generic failure sentence when the upload failed. */
  error?: string;
}

export interface ComposerChipsProps {
  chips: ComposerChip[];
  onRemove(id: string): void;
  onRetry(id: string): void;
  /** Moves the chip at `from` so it lands at `to`. */
  onReorder(from: number, to: number): void;
}

/**
 * Marks a drag as one of our own chips. A file dragged in from the desktop
 * carries no such type and is left to the drop overlay.
 */
const CHIP_DRAG_TYPE = "application/x-stellarr-chip";

/**
 * The pills for queued attachments, reorderable by dragging.
 *
 * This uses the browser's drag and drop rather than a sorting library: moving
 * a handful of pills does not earn a dependency. `drag-chosen` and `drag-ghost`
 * are the classes the stylesheet already carries for the two ends of a drag.
 */
export function ComposerChips({ chips, onRemove, onRetry, onReorder }: ComposerChipsProps) {
  const { t } = useLanguage();
  const [dragged, setDragged] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const endDrag = () => {
    setDragged(null);
    setHovered(null);
  };

  const dragHandlers = (index: number) => ({
    draggable: true,
    onDragStart(event: DragEvent<HTMLDivElement>) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(CHIP_DRAG_TYPE, String(index));
      setDragged(index);
    },
    onDragOver(event: DragEvent<HTMLDivElement>) {
      if (dragged === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setHovered(index);
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      if (dragged === null) return;
      event.preventDefault();
      // The drop overlay listens higher up and would take this for a file drop.
      event.stopPropagation();
      if (dragged !== index) onReorder(dragged, index);
      endDrag();
    },
    onDragEnd: endDrag,
  });

  return (
    <div className="chips">
      {chips.map((chip, index) => {
        const classes = ["chip"];
        if (dragged === index) classes.push("drag-chosen");
        else if (hovered === index) classes.push("drag-ghost");

        return (
          <div key={chip.id} className={classes.join(" ")} {...dragHandlers(index)}>
            <span className="thumb">{fileExt(chip.name, "?")}</span>
            <span className="chip-copy">
              <b>{chip.name}</b>
              {chip.status === "uploading" ? (
                <span className="chip-status" role="status">
                  {t("attachment.uploading")}
                </span>
              ) : null}
              {chip.status === "error" ? (
                <span className="chip-status error" role="alert">
                  {chip.error ?? t("attachment.uploadFailed")}
                </span>
              ) : null}
            </span>
            {chip.status === "error" ? (
              <button
                type="button"
                className="retry"
                aria-label={t("attachment.retryUpload", { name: chip.name })}
                onClick={() => onRetry(chip.id)}
              >
                {t("attachment.retry")}
              </button>
            ) : null}
            <button
              type="button"
              className="x"
              aria-label={`${t("common.remove")} ${chip.name}`}
              onClick={() => onRemove(chip.id)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
