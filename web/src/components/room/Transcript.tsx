"use client";

import { translateForDocument } from "@/i18n/defaultLocale";
import {
  useMemo,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { Icon } from "@/components/icons/Icon";
import type { OpenProfile } from "@/components/view-models";
import type { CustomEmoji } from "@/ports";

import { useHistoryWindow } from "./historyWindow";
import { MessageGroup } from "./MessageGroup";
import type { MessageAction } from "./MessageToolbar";
import type { MessageTranslationOptions } from "./attachments/TranslatedTextAttachment";
import type { AttachmentCallbacks } from "./parts";
import { messageTail, toRows, type TranscriptSectionVM } from "./transcriptRows";
import { useArrivals } from "./useArrivals";
import { useJumpTo } from "./useJumpTo";
import { useTranscriptScroll } from "./useTranscriptScroll";

export type { TranscriptSectionVM } from "./transcriptRows";

/**
 * How close to the end still counts as "reading the latest". Generous enough
 * to survive a rounding-off scrollTop on fractional device pixels, small
 * enough that someone who scrolled up a screen is left alone.
 */
const AT_BOTTOM_PX = 48;

/**
 * Rendered beyond the viewport in both directions. Sized to cover a fast flick
 * between two frames rather than to be frugal: a row that is not mounted when
 * it scrolls into view is a blank patch, which costs a reader far more than a
 * few hundred pixels of DOM.
 */
const OVERSCAN_PX = 900;

/**
 * The opening location has to align the end of the final row, not merely
 * select it. A message group can be taller than the viewport, so the default
 * `start` alignment would open at the top of the group with its newest
 * messages below the fold.
 */
const OPEN_AT_END = { index: "LAST", align: "end" } as const;

export interface TranscriptProps {
  sections: TranscriptSectionVM[];
  /** Region name, e.g. "Messages in #general". */
  label: string;
  /**
   * A thread already supplies the reply context around the whole transcript,
   * so repeating the root reference above every answer would make it read
   * like a stack of quoted replies instead of one conversation.
   */
  hideReplyReferences?: boolean;
  /** The first history page has not arrived yet. */
  loading?: boolean;
  translation?: MessageTranslationOptions;
  onReact?(messageId: string, emoji: string): void;
  onAction?(messageId: string, action: MessageAction): void;
  attachments?: AttachmentCallbacks;
  /** The server's own emoji, for the reaction picker on every block. */
  customEmoji?: readonly CustomEmoji[];
  /** You may moderate this channel: the bin appears on everyone's messages. */
  canModerate?: boolean;
  /** Adds "Kopiuj identyfikator" to every message's right-click menu. */
  developerMode?: boolean;
  /** The message being rewritten, wherever in the transcript it sits. */
  editing?: { id: string; original: string } | null;
  onEditSave?(messageId: string, text: string): Promise<void> | void;
  onEditCancel?(): void;
  /**
   * Changes when the reader sends something of their own.
   *
   * Following an arrival is conditional on already being at the end, which is
   * the right restraint for someone else's message — being yanked mid-read is
   * worse than missing a line. Your own message is not that: you performed an
   * action and the transcript owes you its result, wherever you were reading.
   */
  followOwnSend?: number;
  /** Raises a mini profile from an author's avatar or name. */
  onOpenAuthor?: OpenProfile;
  /**
   * Rendered above the first day separator, inside the scroller.
   *
   * A conversation begins somewhere and says so; a channel that has been going
   * for a year does not. Passing it as a row rather than as a sibling is what
   * makes it scroll away with the history instead of sitting on top of it like
   * a banner.
   */
  intro?: ReactNode;
  /**
   * The first block that arrived after this channel was last read. A line goes
   * above it, and stays there while the reader works down to it — the mark
   * behind this only moves when the channel is left.
   */
  firstUnreadGroupId?: string | null;
  /** Loads the next backwards page when the reader reaches the oldest row. */
  onLoadOlder?(): void;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  /**
   * Takes the transcript's "go to this message" for whoever is outside it.
   *
   * The scroll is an index into a windowed list, so only this component can
   * perform it — but the channel panel's pinned list needs it. It is the same
   * function the reply line uses, so both doors behave identically: a message
   * outside the loaded window is not scrolled to, because there is nothing to
   * scroll to yet.
   */
  onJumpReady?(jumpTo: (messageId: string) => void): void;
}

/**
 * The message list.
 *
 * Windowed by `react-virtuoso`, which does the genuinely hard parts: it
 * measures every row as it renders and holds the scroll position steady when a
 * row above the viewport turns out taller than it looked. A transcript full of
 * images that decode at their own pace would jump under the reader otherwise.
 *
 * The one rule the CSS has to respect: rows are spaced with padding, never
 * margins. A margin escapes the box the virtualiser measures, and every row
 * would be reported a few pixels short — see `transcript.css`.
 */
export function Transcript({ loading = false, ...props }: TranscriptProps) {
  // `initialTopMostItemIndex` is consumed when Virtuoso mounts. Mounting it
  // against an empty array and filling the array afterwards makes the opening
  // position racy. The empty log keeps the pane's geometry while the first page
  // is in flight; the real list then mounts once, already pointed at its end.
  if (loading) {
    return (
      <div
        className="transcript"
        role="log"
        aria-live="polite"
        aria-label={props.label}
        aria-busy="true"
      />
    );
  }
  return <ReadyTranscript {...props} />;
}

function ReadyTranscript({
  sections,
  label,
  hideReplyReferences = false,
  translation,
  onReact,
  onAction,
  attachments,
  customEmoji,
  canModerate,
  developerMode,
  editing,
  onEditSave,
  onEditCancel,
  onOpenAuthor,
  intro,
  firstUnreadGroupId = null,
  followOwnSend,
  onLoadOlder,
  hasOlder = false,
  loadingOlder = false,
  onJumpReady,
}: Omit<TranscriptProps, "loading">) {
  const t = translation?.t ?? translateForDocument;
  const rows = useMemo(
    () => toRows(sections, firstUnreadGroupId),
    [sections, firstUnreadGroupId],
  );
  const tail = useMemo(() => messageTail(rows), [rows]);

  const virtuoso = useRef<VirtuosoHandle>(null);
  const scroll = useTranscriptScroll({ virtuoso, tail, followOwnSend });
  const history = useHistoryWindow(rows);
  const { flashId, jumpTo } = useJumpTo(rows, virtuoso, onJumpReady);
  const { freshId, missed, dismissMissed } = useArrivals(
    rows.at(-1)?.id,
    scroll.atBottom,
  );

  // A new `components` object remounts the scroller and loses its place, so it
  // is rebuilt only when the intro itself changes.
  const components = useMemo(
    () => ({
      List: TranscriptList,
      ...(intro === undefined ? {} : { Header: () => <>{intro}</> }),
    }),
    [intro],
  );

  /*
   * The way back down belongs to being scrolled up, not to having missed
   * something: scrolling up is the only way to read anything older than a
   * screen, and the way back used to be the same drag in reverse. What
   * arrivals change is what it says — an arrow while reading, "New
   * messages" once something landed below, because the list deliberately
   * does not follow the end for a reader who is elsewhere.
   */
  const catchUp = () => {
    dismissMissed();
    virtuoso.current?.scrollToIndex({
      index: rows.length - 1,
      align: "end",
      behavior: "smooth",
    });
  };

  const loadOlder =
    hasOlder && !loadingOlder && onLoadOlder !== undefined
      ? () => {
          history.anchorHere();
          onLoadOlder();
        }
      : undefined;

  return (
    // The scroller keeps its own class and its own box; this only gives the
    // catch-up button something to be positioned against.
    <div className="transcript-area">
      <Virtuoso
        ref={virtuoso}
        scrollerRef={scroll.setScroller}
        className={scroll.ready ? "transcript" : "transcript opening"}
        role="log"
        aria-busy={!scroll.ready}
        aria-live="polite"
        aria-relevant="additions"
        aria-label={label}
        data={rows}
        firstItemIndex={history.firstItemIndex}
        computeItemKey={(_, row) => row.id}
        // A transcript too short to scroll sits at the bottom of the pane.
        alignToBottom
        initialTopMostItemIndex={OPEN_AT_END}
        // Groups grow in place, so the scroller is moved before paint by
        // `useTranscriptScroll`; the built-in mode would only snap after the
        // row had been seen to resize.
        followOutput={false}
        totalListHeightChanged={scroll.onTotalListHeightChanged}
        startReached={loadOlder}
        rangeChanged={({ startIndex }) => history.noteVisibleStart(startIndex)}
        atBottomStateChange={scroll.onAtBottomStateChange}
        atBottomThreshold={AT_BOTTOM_PX}
        increaseViewportBy={OVERSCAN_PX}
        components={components}
        itemContent={(_, row) => {
          if (row.kind === "day") return <div className="day-sep">{row.day}</div>;
          if (row.kind === "unread") {
            return <div className="unread-sep">{t("message.unread")}</div>;
          }
          const { group } = row;
          return (
            <MessageGroup
              {...group}
              replyTo={hideReplyReferences ? undefined : group.replyTo}
              fresh={row.id === freshId}
              highlight={row.id === flashId}
              onOpenReply={hideReplyReferences ? undefined : jumpTo}
              translation={translation}
              attachments={attachments}
              customEmoji={customEmoji}
              canModerate={canModerate}
              developerMode={developerMode}
              editing={editing}
              onEditSave={onEditSave}
              onEditCancel={onEditCancel}
              onReact={onReact}
              onAction={onAction}
              onOpenAuthor={
                onOpenAuthor
                  ? (anchor) => onOpenAuthor(group.authorId, anchor)
                  : undefined
              }
            />
          );
        }}
      />
      {scroll.atBottom ? null : (
        <button
          type="button"
          className={missed ? "tr-jump" : "tr-jump bare"}
          // The pill names itself; the bare arrow has to be named here.
          aria-label={missed ? undefined : t("message.goLatest")}
          onClick={catchUp}
        >
          {missed ? t("message.unread") : null}
          <Icon name="caret" size={missed ? 13 : 15} />
        </button>
      )}
    </div>
  );
}

/**
 * The element the rows live in.
 *
 * Named so the `.transcript-inner` rules apply. The virtualiser owns its inline
 * styles (the padding that stands in for unrendered rows) and puts more on this
 * element than the style attribute, so everything it passes is forwarded and
 * this sets no layout of its own.
 */
function TranscriptList({ children, ...rest }: ComponentPropsWithRef<"div">) {
  return (
    <div {...rest} className="transcript-inner">
      {children}
    </div>
  );
}
