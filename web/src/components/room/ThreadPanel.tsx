"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/icons/Icon";
import { useLanguage } from "@/state/hooks";

import { Transcript, type TranscriptProps } from "./Transcript";

interface ThreadPanelProps extends TranscriptProps {
  open: boolean;
  /** Spans the whole middle of the room instead of sitting beside it. */
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  onClose(): void;
  composer?: ReactNode;
}

export function ThreadPanel({
  open,
  expanded,
  onExpandedChange,
  onClose,
  composer,
  ...transcript
}: ThreadPanelProps) {
  const { t } = useLanguage();
  const className = ["thread-panel", open && "open", expanded && "expanded"]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={className} inert={!open} aria-label={t("room.thread")}>
      <div className="thread-panel-inner">
        <header className="thread-panel-head">
          <b>{t("room.thread")}</b>
          <div className="thread-panel-actions">
            <button
              type="button"
              aria-label={expanded ? t("room.restoreThread") : t("room.expandThread")}
              aria-pressed={expanded}
              onClick={() => onExpandedChange(!expanded)}
            >
              <Icon name={expanded ? "collapse" : "expand"} size={16} />
            </button>
            <button type="button" aria-label={t("room.closeThread")} onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </header>
        <div className="thread-panel-body">
          <Transcript {...transcript} hideReplyReferences />
        </div>
        {composer}
      </div>
    </aside>
  );
}
