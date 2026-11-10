"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/icons/Icon";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { MessageKey } from "@/i18n";
import {
  EMOJI,
  EMOJI_CATEGORIES,
  pushRecentEmoji,
  readRecentEmoji,
  searchEmoji,
  type EmojiCategoryId,
  type EmojiEntry,
} from "@/lib/emoji";
import type { CustomEmoji } from "@/ports";
import { useLanguage } from "@/state/LanguageProvider";

const categoryLabel = (id: EmojiCategoryId): MessageKey => `emoji.${id}`;

/**
 * Arrow up and down move by a row, so the column count here has to change at
 * the same widths as the grid in `emoji.css`: nine columns need a panel wide
 * enough to give each one a 44px touch target.
 */
function useColumns(): number {
  const phone = useMediaQuery("(max-width: 559px)", false);
  const narrowPhone = useMediaQuery("(max-width: 359px)", false);
  if (narrowPhone) return 5;
  return phone ? 6 : 9;
}

/**
 * Where an arrow or Home/End key sends the cursor: a cell index, "search" for
 * off the top of the grid, or null for a key the grid ignores.
 */
function destination(
  key: string,
  from: number,
  columns: number,
  count: number,
): number | "search" | null {
  switch (key) {
    case "ArrowRight":
      return from + 1;
    case "ArrowLeft":
      return from - 1;
    case "ArrowDown":
      return from + columns;
    case "ArrowUp":
      return from < columns ? "search" : from - columns;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** A server's own emoji in the shape the grid renders. */
function toEntry({ shortcode, glyph }: CustomEmoji): EmojiEntry {
  const code = shortcode.replace(/^:|:$/g, "");
  return {
    glyph,
    imageUrl: glyph,
    shortcode: code,
    category: "server",
    terms: `${code.replaceAll("_", " ")} serwer`,
  };
}

function Glyph({ entry }: { entry: EmojiEntry }) {
  if (entry.imageUrl === undefined) return <>{entry.glyph}</>;
  return <img src={entry.imageUrl} alt="" width={26} height={26} loading="lazy" />;
}

interface Section {
  id: EmojiCategoryId | "results";
  label: string;
  entries: EmojiEntry[];
  /** Index of the first entry in the grid taken as one list. */
  start: number;
}

/** Numbers each section's first entry, so the keyboard can treat the grid as one list. */
function withOffsets(parts: Omit<Section, "start">[]): Section[] {
  let start = 0;
  return parts.map((part) => {
    const section = { ...part, start };
    start += part.entries.length;
    return section;
  });
}

export interface EmojiPickerProps {
  /** The server's own emoji. They lead the list: nowhere else offers them. */
  customEmoji?: readonly CustomEmoji[];
  /**
   * A pick. The host decides what it means (text into the composer, a reaction
   * on a message) and whether the picker stays open.
   */
  onPick: (entry: EmojiEntry) => void;
  /** Escape in the search field. */
  onClose?: () => void;
  /** False for a touch-opened picker, so browsing does not raise the keyboard. */
  autoFocus?: boolean;
}

/**
 * The emoji picker: a search field, a rail of categories, a sectioned grid and
 * a footer naming whatever is under the pointer, which is how a `:shortcode:`
 * becomes something a person can type next time.
 *
 * The grid is one roving tab stop. Arrows move by a cell or a row, Enter in
 * the search field sends the first match, and the whole picker is reachable
 * without a mouse.
 */
export function EmojiPicker({
  customEmoji = [],
  onPick,
  onClose,
  autoFocus = true,
}: EmojiPickerProps) {
  const { t } = useLanguage();
  const columns = useColumns();
  const [query, setQuery] = useState("");
  // Read on first render, not in an effect: the picker only mounts on a click,
  // so there is no server render for localStorage to disagree with.
  const [recent, setRecent] = useState<string[]>(readRecentEmoji);
  const [cursor, setCursor] = useState(0);
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      // If the user has already moved focus into the picker by the time this
      // frame runs, taking it back to the search field would be a jump.
      const active = document.activeElement;
      const movedIn = active === searchRef.current || gridRef.current?.contains(active);
      if (!movedIn) searchRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const server = useMemo(() => customEmoji.map(toEntry), [customEmoji]);

  const sections = useMemo<Section[]>(() => {
    if (query.trim().length > 0) {
      const results = searchEmoji([...server, ...EMOJI], query);
      return withOffsets([{ id: "results", label: t("emoji.results"), entries: results }]);
    }

    const byCode = new Map([...server, ...EMOJI].map((entry) => [entry.shortcode, entry]));
    // A recent whose emoji was since deleted from the server drops out here.
    const recents = recent
      .flatMap((code) => byCode.get(code) ?? [])
      // Two full rows at the current width, never a ragged third.
      .slice(0, columns * 2);

    const parts: Omit<Section, "start">[] = [];
    if (recents.length > 0) {
      parts.push({ id: "recent", label: t("emoji.recent"), entries: recents });
    }
    if (server.length > 0) {
      parts.push({ id: "server", label: t("emoji.server"), entries: server });
    }
    for (const { id } of EMOJI_CATEGORIES) {
      if (id === "recent" || id === "server") continue;
      const entries = EMOJI.filter((entry) => entry.category === id);
      if (entries.length > 0) parts.push({ id, label: t(categoryLabel(id)), entries });
    }
    return withOffsets(parts);
  }, [columns, query, recent, server, t]);

  const flat = useMemo(() => sections.flatMap((section) => section.entries), [sections]);
  // A narrowing search can leave the stored cursor past the end of the list.
  const active = Math.min(cursor, Math.max(flat.length - 1, 0));
  const shown = hovered ?? flat[active] ?? null;

  const pick = (entry: EmojiEntry) => {
    setRecent(pushRecentEmoji(entry.shortcode));
    onPick(entry);
  };

  const scrollToSection = (id: EmojiCategoryId) => {
    scrollRef.current
      ?.querySelector(`[data-section="${id}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Section headings break the grid's geometry, so a cell is brought into view
  // by scrolling to it rather than by computing an offset.
  const focusCell = (index: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, index));
    setCursor(next);
    const cell = gridRef.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`);
    cell?.focus();
    cell?.scrollIntoView({ block: "nearest" });
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = destination(event.key, active, columns, flat.length);
    if (next === null) return;
    event.preventDefault();
    if (next === "search") searchRef.current?.focus();
    else focusCell(next);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose?.();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = flat[0];
      if (first !== undefined) pick(first);
    } else if (event.key === "ArrowDown" && flat.length > 0) {
      event.preventDefault();
      focusCell(0);
    }
  };

  const searching = query.trim().length > 0;

  return (
    <div className="emo-pick">
      <div className="emo-pick-search">
        <Icon name="search" size={15} />
        <input
          ref={searchRef}
          type="text"
          value={query}
          placeholder={t("emoji.search")}
          aria-label={t("emoji.search")}
          aria-controls={listId}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={onSearchKeyDown}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="emo-pick-clear"
            aria-label={t("emoji.clearSearch")}
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <div className="emo-pick-body">
        {/* A search has a single section, so there is nothing to navigate. */}
        {!searching && (
          <nav className="emo-pick-rail" aria-label={t("emoji.categories")}>
            {EMOJI_CATEGORIES.filter(({ id }) => {
              if (id === "recent") return recent.length > 0;
              if (id === "server") return server.length > 0;
              return true;
            }).map(({ id, mark }) => (
              <button
                key={id}
                type="button"
                className="emo-pick-cat"
                aria-label={t(categoryLabel(id))}
                title={t(categoryLabel(id))}
                onClick={() => scrollToSection(id)}
              >
                <span aria-hidden="true">{mark}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="emo-pick-scroll" ref={scrollRef}>
          {flat.length === 0 ? (
            <p className="emo-pick-empty">{t("emoji.noResults")}</p>
          ) : (
            <div
              id={listId}
              ref={gridRef}
              role="listbox"
              aria-label={t("emoji.search")}
              onKeyDown={onGridKeyDown}
            >
              {sections.map((section) => (
                <section key={section.id} data-section={section.id}>
                  <h3 className="emo-pick-head">{section.label}</h3>
                  <div className="emo-pick-grid">
                    {section.entries.map((entry, index) => {
                      const flatIndex = section.start + index;
                      return (
                        <button
                          key={`${section.id}-${entry.shortcode}`}
                          type="button"
                          role="option"
                          aria-selected={flatIndex === active}
                          aria-label={`:${entry.shortcode}:`}
                          className="emo-pick-tile"
                          data-index={flatIndex}
                          // One tab stop for the grid; hundreds would make Tab
                          // useless for reaching anything after it.
                          tabIndex={flatIndex === active ? 0 : -1}
                          onFocus={() => setCursor(flatIndex)}
                          onMouseEnter={() => setHovered(entry)}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => pick(entry)}
                        >
                          <Glyph entry={entry} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="emo-pick-foot">
        {shown === null ? (
          <span className="emo-pick-hint">{t("emoji.choose")}</span>
        ) : (
          <>
            <span className="emo-pick-big" aria-hidden="true">
              <Glyph entry={shown} />
            </span>
            <b>:{shown.shortcode}:</b>
            {shown.category === "server" && (
              <span className="emo-pick-tag">{t("emoji.fromServer")}</span>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
