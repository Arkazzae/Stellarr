"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Icon, type IconName } from "@/components/icons/Icon";
import { useLanguage } from "@/state/hooks";

export interface RailLauncherItem {
  key: string;
  icon: IconName;
  label: string;
  /** Second line of the row's name: what it does, or why it cannot yet. */
  hint?: string;
  /** Without it there is nothing behind the row and it renders disabled. */
  onSelect?: () => void;
}

export interface RailLauncherProps {
  items: RailLauncherItem[];
  /** The tile's own label; the menu is named after it. */
  label?: string;
}

/** Long enough to cross the gap between the tile and the card, short enough
 *  that the card does not linger once the pointer has really left. */
const CLOSE_DELAY_MS = 140;

/**
 * The tile at the foot of the server column and the card of actions that
 * rises out of it.
 *
 * These actions concern the server list as a whole (make a server, find one,
 * install the app), so they live under the list rather than in it. Hovering
 * the tile opens the card, but hover is never the only way in: focus opens it
 * too, Escape closes it, and its rows are ordinary buttons in the tab order.
 */
export function RailLauncher({ items, label }: RailLauncherProps) {
  const { t } = useLanguage();
  const tileLabel = label ?? t("voiceBar.more");
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether a click, rather than the pointer passing over, opened the card. A
   * card opened by hover must not shut under the click that lands on the tile
   * it is already showing; only a pinned one toggles closed.
   */
  const pinned = useRef(false);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    cancelScheduledClose();
    pinned.current = false;
    setOpen(false);
  }, [cancelScheduledClose]);

  const show = useCallback(() => {
    cancelScheduledClose();
    setOpen(true);
  }, [cancelScheduledClose]);

  // Closing on the first `pointerleave` would shut the card in the gap
  // between the tile and the card.
  const closeSoon = useCallback(() => {
    cancelScheduledClose();
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  }, [cancelScheduledClose, close]);

  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  // A finger never leaves the tile the way a mouse does, so on a phone the
  // card is dismissed like any other panel: by a press outside it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <div
      ref={wrapRef}
      className="srv-launcher"
      // A tap is not a hover: opening on `pointerenter` for touch would raise
      // the card on the tap that is about to toggle it.
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") show();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") closeSoon();
      }}
      onFocus={show}
      onBlur={(event) => {
        // Focus moving from the tile into the card stays inside the launcher.
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // `AppShell` listens on `window`; stopping here closes the card
        // without also closing a drawer underneath it.
        event.stopPropagation();
        // Focus first: arriving on the tile from a row opens the card, and
        // closing afterwards is what wins.
        tileRef.current?.focus();
        close();
      }}
    >
      {/* Siblings of the tile rather than children: a button may not contain
          buttons. Staying mounted keeps `hidden` and `aria-expanded` in step. */}
      <div className="srv-menu" id={menuId} hidden={!open}>
        {items.map((item, index) => {
          // The tile shows only an icon, so the name carries the hint.
          const name = item.hint === undefined ? item.label : `${item.label} — ${item.hint}`;
          return (
            <button
              key={item.key}
              type="button"
              className="srv-menu-tile"
              // The card opens upwards, so the first item is the last in the
              // unfold order and sits nearest the tile.
              style={{ "--i": items.length - 1 - index } as CSSProperties}
              title={name}
              aria-label={name}
              disabled={item.onSelect === undefined}
              onClick={() => {
                close();
                item.onSelect?.();
              }}
            >
              <Icon name={item.icon} size={19} />
            </button>
          );
        })}
      </div>

      <button
        ref={tileRef}
        type="button"
        className="srv-item more"
        title={tileLabel}
        aria-label={tileLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open && pinned.current) {
            close();
            return;
          }
          pinned.current = true;
          show();
        }}
      >
        <span className="srv-more-glyph">
          <Icon name="launcher" size={20} />
        </span>
      </button>
    </div>
  );
}
