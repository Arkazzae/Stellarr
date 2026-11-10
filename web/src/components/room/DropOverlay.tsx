"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons/Icon";
import { useLanguage } from "@/state/hooks";

/** Files past this many in one drop are left behind. */
const MAX_FILES = 5;

export interface DropOverlayProps {
  /** Bare channel name; the card reads "Upuść, aby dodać do #ogólny". */
  channelName: string;
  /**
   * False while the room shows something other than that channel's transcript,
   * a call most of all. An armed overlay would attach the drop to whichever
   * text channel happens to be selected behind the stage, which posts a file to
   * a channel nobody is looking at.
   */
  enabled?: boolean;
  onDropFiles(files: File[]): void;
}

/**
 * The whole-window file drop target.
 *
 * Its listeners are on the window, not the composer, because a file may be
 * dropped anywhere in the app. `dragenter` and `dragleave` fire for every
 * element the pointer crosses, so a plain flag would flicker at each child
 * boundary; the card is shown while the number of entered elements is above
 * zero instead.
 */
export function DropOverlay({ channelName, enabled = true, onDropFiles }: DropOverlayProps) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);
  // True from the moment something inside the app starts a drag. Chromium
  // describes a dragged page image as a file, so an avatar pulled across the
  // window would look like a picture from the file manager and be attached.
  const internalDrag = useRef(false);
  // Read at drop time, so a parent that passes a new function on every render
  // does not tear the listeners down, and the card with them, in mid-drag.
  const onDropFilesRef = useRef(onDropFiles);
  useEffect(() => {
    onDropFilesRef.current = onDropFiles;
  }, [onDropFiles]);

  useEffect(() => {
    if (!enabled) return;
    const fromOutside = (event: DragEvent) =>
      !internalDrag.current && Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragStart = () => {
      internalDrag.current = true;
      depth.current = 0;
      setVisible(false);
    };
    const onDragEnd = () => {
      internalDrag.current = false;
    };
    const onDragEnter = (event: DragEvent) => {
      if (!fromOutside(event)) return;
      event.preventDefault();
      depth.current += 1;
      setVisible(true);
    };
    // Cancelling dragover is what stops the browser navigating to the file.
    const onDragOver = (event: DragEvent) => {
      if (fromOutside(event)) event.preventDefault();
    };
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVisible(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!fromOutside(event)) {
        internalDrag.current = false;
        return;
      }
      event.preventDefault();
      depth.current = 0;
      setVisible(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onDropFilesRef.current(files.slice(0, MAX_FILES));
    };

    // Capturing for the two that mark a drag as internal, so it is known before
    // the dragenter it raises on the window gets here.
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      // Disarmed in mid-drag, by a call taking the room for one, the counter
      // and the card would otherwise outlive the listeners that maintain them.
      depth.current = 0;
      internalDrag.current = false;
      setVisible(false);
    };
  }, [enabled]);

  return (
    <div className={visible && enabled ? "drop-overlay show" : "drop-overlay"}>
      <div className="drop-card">
        <Icon name="dropTray" size={36} className="di" />
        <b>{t("drop.addToChannel", { channel: channelName })}</b>
        <span>{t("drop.limits")}</span>
      </div>
    </div>
  );
}
