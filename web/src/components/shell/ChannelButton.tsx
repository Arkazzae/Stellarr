"use client";

import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { CSSProperties, KeyboardEvent, MouseEvent, Ref } from "react";

import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/hooks";

/**
 * The output of `@dnd-kit`'s `useSortable` for the row being carried.
 *
 * The library owns the pointer sensor, the transform and the keyboard; the row
 * only forwards what it is given. Its activation constraint (a press has to
 * travel a few pixels) is what lets the main button be both the drag handle
 * and a plain click target.
 */
export interface ChannelDragProps {
  /** `setNodeRef` rather than a ref object: the library owns the node. */
  setNode: Ref<HTMLDivElement>;
  style: CSSProperties;
  dragging: boolean;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

export interface ChannelButtonProps {
  kind: "text" | "voice";
  name: string;
  /** Marks the channel the room is showing with `aria-current="page"`. */
  active?: boolean;
  /** Voice only; hidden at zero. */
  count?: number;
  /** Spoken form of the count, such as "2 osoby w rozmowie". */
  countLabel?: string;
  /** Messages that arrived while you were elsewhere: brightens the row and adds a badge. */
  unread?: number;
  /** This user's notification mute; shown independently of the unread badge. */
  muted?: boolean;
  /** Text only. Non-zero when the channel has a nested thread list. */
  threadCount?: number;
  threadsOpen?: boolean;
  threadsId?: string;
  onToggleThreads?: () => void;
  /** Shown on hover to whoever may edit the channel. */
  onOpenSettings?: () => void;
  onSelect: () => void;
  /** Right-click. Without it the browser's own menu is left alone. */
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  drag?: ChannelDragProps;
}

const MAX_UNREAD_SHOWN = 99;

/**
 * One channel row of the rail.
 *
 * The row is a visual group of sibling buttons (select, disclose threads, open
 * settings), never a button holding buttons, so touch and assistive technology
 * do not have to resolve nested targets. When sorting is on, only the main
 * button is the drag handle.
 */
export function ChannelButton({
  kind,
  name,
  active,
  count,
  countLabel,
  unread = 0,
  muted = false,
  threadCount = 0,
  threadsOpen = false,
  threadsId,
  onToggleThreads,
  onOpenSettings,
  onSelect,
  onContextMenu,
  drag,
}: ChannelButtonProps) {
  const { t } = useLanguage();

  const className = [
    "channel",
    active && "active",
    unread > 0 && "unread",
    drag?.dragging && "drag-chosen",
  ]
    .filter(Boolean)
    .join(" ");

  const { onKeyDown: sortableKeyDown, ...pointerListeners } = drag?.listeners ?? {};
  const handleKeyDown =
    drag === undefined
      ? undefined
      : (event: KeyboardEvent<HTMLButtonElement>) => {
          // Enter follows the channel; Space stays the sortable keyboard gesture.
          if (event.key !== "Enter") {
            sortableKeyDown?.(event);
            return;
          }
          event.preventDefault();
          onSelect();
        };

  const showThreadsToggle =
    kind === "text" && threadCount > 0 && onToggleThreads !== undefined;
  const threadsLabel = t(
    threadsOpen ? "shell.hideChannelThreads" : "shell.showChannelThreads",
    { name },
  );

  return (
    <div
      ref={drag?.setNode}
      style={drag?.style}
      className={className}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="channel-main"
        aria-current={active ? "page" : undefined}
        {...drag?.attributes}
        {...pointerListeners}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
      >
        <span className="glyph" aria-hidden="true">
          {kind === "text" ? "#" : <Icon name="speaker" size={14} />}
        </span>
        <span className="name">{name}</span>
        {kind === "text" && muted ? (
          <span
            className="ch-muted"
            aria-label={t("channel.notificationsMuted")}
            title={t("channel.notificationsMuted")}
          >
            <Icon name="bellSlash" size={13} />
          </span>
        ) : null}
        {unread > 0 ? (
          <span className="ch-unread" aria-label={t("shell.unreadChannel", { count: unread })}>
            {unread > MAX_UNREAD_SHOWN ? `${MAX_UNREAD_SHOWN}+` : unread}
          </span>
        ) : null}
        {kind === "voice" ? (
          <span className="count" hidden={!count} aria-label={countLabel}>
            {count ?? 0}
          </span>
        ) : null}
      </button>
      {showThreadsToggle ? (
        <button
          type="button"
          className="ch-threads-toggle"
          aria-expanded={threadsOpen}
          aria-controls={threadsId}
          aria-label={threadsLabel}
          title={threadsLabel}
          onClick={onToggleThreads}
        >
          <Icon name="caret" size={10} />
        </button>
      ) : null}
      {onOpenSettings === undefined ? null : (
        <button
          type="button"
          className="ch-cog"
          aria-label={t("channel.settingsLabel", { name })}
          title={t("voiceBar.channelSettings")}
          onClick={onOpenSettings}
        >
          <Icon name="gear" size={13} />
        </button>
      )}
    </div>
  );
}
