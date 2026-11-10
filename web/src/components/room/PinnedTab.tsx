"use client";

import { IconButton } from "@/components/primitives/IconButton";
import { formatFull } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

import type { PinnedMessageVM } from "./channelPanelModel";

export interface PinnedTabProps {
  /** Newest pin first. */
  pinned: PinnedMessageVM[];
  /** The list is still being fetched; an empty panel would be a wrong answer. */
  loading: boolean;
  /** Why the last pin or unpin did not take. */
  error: string | null;
  /** A server without the endpoint; false says so instead of showing an empty list. */
  supported: boolean;
  /**
   * Scrolls the transcript to a pin and flashes it. Absent, the row is still
   * worth reading, so it stays a row rather than a button that does nothing.
   */
  onOpen?(messageId: string): void;
  /** Absent for anyone who may not moderate. */
  onUnpin?(messageId: string): void;
}

/**
 * One pinned message: who said it, when, and one line of what.
 *
 * The date is the message's, not the pin's: "when was that said" is how anyone
 * finds the thing again, and the order of the list already carries the pin time.
 */
function PinBody({ item }: { item: PinnedMessageVM }) {
  const { locale, t } = useLanguage();
  return (
    <>
      <span className="cp-pin-head">
        <b>{item.authorName}</b>
        <time dateTime={item.timestamp}>{formatFull(item.timestamp, locale)}</time>
      </span>
      <span className="cp-pin-text">
        {item.preview.length === 0 ? t("room.emptyMessage") : item.preview}
      </span>
    </>
  );
}

export function PinnedTab({
  pinned,
  loading,
  error,
  supported,
  onOpen,
  onUnpin,
}: PinnedTabProps) {
  const { t } = useLanguage();

  return (
    <>
      {error === null ? null : (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
      {!supported ? (
        <p className="cp-empty">{t("room.pinUnsupported")}</p>
      ) : loading ? (
        <p className="cp-empty">{t("room.loadingPins")}</p>
      ) : pinned.length === 0 ? (
        <p className="cp-empty">{t("room.noPins")}</p>
      ) : (
        <ul className="cp-pins">
          {pinned.map((item) => (
            <li key={item.id} className="cp-pin">
              {onOpen === undefined ? (
                <span className="cp-pin-open">
                  <PinBody item={item} />
                </span>
              ) : (
                // The whole row opens the message: it is what a pointer aims at.
                <button
                  type="button"
                  className="cp-pin-open"
                  title={t("room.goToMessage")}
                  onClick={() => onOpen(item.id)}
                >
                  <PinBody item={item} />
                </button>
              )}
              {onUnpin === undefined ? null : (
                <IconButton
                  icon="pin"
                  label={t("room.unpinMessageFrom", { name: item.authorName })}
                  title={t("room.unpin")}
                  className="cp-pin-off"
                  onClick={() => onUnpin(item.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
