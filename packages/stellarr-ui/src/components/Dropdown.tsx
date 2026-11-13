"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { allowScroll, useLayer } from "../behavior/layers";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons/Icon";

/** Between the field and the list. */
const GAP = 6;
/** The least room the list leaves to the edge of the window. */
const EDGE = 12;
/** The narrowest the list gets, whatever the field's own width. */
const MIN_LIST_WIDTH = 180;
/** The list is never shorter than this, nor taller than that. */
const MIN_LIST_HEIGHT = 120;
const MAX_LIST_HEIGHT = 320;
/** How long a typed prefix stays alive before the next key starts a new one. */
const TYPEAHEAD_MS = 600;

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /**
   * A second line in the list and a muted tail on the field. It is the reason
   * to pick this option, not part of its name, so it is not folded into the
   * label the way a native `<select>` would have to.
   */
  detail?: string;
  icon?: IconName;
  /**
   * The language of the label, for an option that is not in the page's: a
   * language picker names each language in itself.
   */
  lang?: string;
  disabled?: boolean;
}

export interface DropdownProps<T extends string> {
  options: readonly DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * The accessible name. Pass `id` instead when a visible `<label for>` already
   * names the field: two names is one too many.
   */
  label?: string;
  id?: string;
  /**
   * Submits the value with the form the field sits in, under this name. A
   * disabled field submits nothing, as a disabled `<select>` does not.
   */
  name?: string;
  disabled?: boolean;
  /** Draws the field as refused and says so to assistive tech. */
  invalid?: boolean;
  /** The id of the text that describes the field, such as a hint or an error. */
  "aria-describedby"?: string;
  /**
   * Shown when the value names nothing in the list, such as an unplugged
   * device. Without one the field is empty then.
   */
  placeholder?: string;
  /**
   * `field` fills a form row like a text input. `quiet` is a bare control for
   * chrome, where a boxed field would be a second frame inside one that is
   * already drawn.
   */
  variant?: "field" | "quiet";
  className?: string;
}

interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  /** Which way it opened, so the animation can grow from the field. */
  above: boolean;
}

/**
 * Where the list goes: under the field, where the value it replaces is. It
 * flips above only when the space below cannot hold it and the space above is
 * larger, because a list that jumps over the field to gain two rows costs more
 * than it saves.
 */
function placeList(
  field: DOMRect,
  list: { height: number },
  view: { width: number; height: number },
): Placement {
  const spaceBelow = view.height - field.bottom - GAP - EDGE;
  const spaceAbove = field.top - GAP - EDGE;
  const above = list.height > spaceBelow && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    MIN_LIST_HEIGHT,
    Math.min(MAX_LIST_HEIGHT, above ? spaceAbove : spaceBelow),
  );
  // Never narrower than the field, so the value does not shift sideways as the
  // list opens under it.
  const width = Math.max(field.width, MIN_LIST_WIDTH);

  return {
    left: Math.max(EDGE, Math.min(field.left, view.width - EDGE - width)),
    top: above
      ? field.top - GAP - Math.min(list.height, maxHeight)
      : field.bottom + GAP,
    width,
    maxHeight,
    above,
  };
}

/**
 * A single choice from a list.
 *
 * A native `<select>` draws its list with the operating system's widget: the
 * app's palette outside the field and the system's grey inside it, no room for
 * a second line, nothing to theme. This is the same control built from the
 * package's own parts, so it carries the app's tokens.
 *
 * It is a combobox with a listbox popup. Focus never leaves the field: the
 * arrows move a cursor, `aria-activedescendant` says where it is, and Enter
 * commits, which keeps the whole control to one tab stop as a `<select>` has.
 *
 * The list is portalled to `<body>` because a scrolling container or a
 * transformed ancestor would clip or shift a list placed inside.
 */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  label,
  id,
  name,
  disabled,
  invalid,
  "aria-describedby": describedBy,
  placeholder,
  variant = "field",
  className,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ prefix: "", at: 0 });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const selected = options.findIndex((option) => option.value === value);
  const current = options[selected];

  const reposition = useCallback(() => {
    const field = fieldRef.current;
    const list = listRef.current;
    if (field === null || list === null) return;
    // `scrollHeight` leaves the borders out, and a list that opens above is
    // placed by its height, so they are added back. They are what the box has
    // beyond its client area, which stays right when the list is capped.
    const placement = placeList(
      field.getBoundingClientRect(),
      { height: list.scrollHeight + list.offsetHeight - list.clientHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    // Written to the element rather than kept in state, and as custom
    // properties rather than `left` and `top`, so a stylesheet can still
    // override where the list goes.
    list.style.setProperty("--_x", `${placement.left}px`);
    list.style.setProperty("--_y", `${placement.top}px`);
    list.style.setProperty("--_dropdown-width", `${placement.width}px`);
    list.style.setProperty("--_dropdown-max-height", `${placement.maxHeight}px`);
    list.toggleAttribute("data-above", placement.above);
    list.dataset.placed = "";
  }, []);

  // Placed before paint: a frame at the wrong coordinates is a visible jump,
  // right next to where the eye already is.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;

    // The list belongs to a form row, not to a pointer position, so it follows
    // the field when something scrolls.
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  // A dialog or a sheet that holds the page still lets only its own element
  // scroll, and the list is drawn in <body>, outside it.
  useEffect(() => {
    if (!open) return;
    return allowScroll(() => (listRef.current === null ? [] : [listRef.current]));
  }, [open]);

  useLayer(open, {
    node: () => listRef.current,
    // The field toggles itself; closing on a press there too would reopen the
    // list.
    owns: (target) =>
      listRef.current?.contains(target) === true || fieldRef.current?.contains(target) === true,
    onEscape: (event) => {
      event.preventDefault();
      setOpen(false);
    },
    onPointerDownOutside: () => {
      setOpen(false);
    },
  });

  // Keep the cursor row in view: opening twenty devices at the top when the
  // fifteenth is in use would make the current value the one thing to hunt for.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>("[data-on]")
      ?.scrollIntoView({ block: "nearest" });
  }, [open, cursor]);

  const openList = () => {
    setCursor(Math.max(selected, 0));
    setOpen(true);
  };

  const commit = (index: number) => {
    const option = options[index];
    if (option === undefined || option.disabled === true) return;
    setOpen(false);
    fieldRef.current?.focus();
    if (option.value !== value) onChange(option.value);
  };

  /** The nearest enabled option in a direction, or `from` when there is none. */
  const step = (from: number, direction: 1 | -1): number => {
    for (let i = from + direction; i >= 0 && i < options.length; i += direction) {
      if (options[i]?.disabled !== true) return i;
    }
    return from;
  };

  /** Type to jump, as a native select does. */
  const typeahead = (key: string) => {
    const now = Date.now();
    const stale = now - typed.current.at > TYPEAHEAD_MS;
    const prefix = (stale ? "" : typed.current.prefix) + key.toLowerCase();
    typed.current = { prefix, at: now };

    // Search from just after the cursor, so repeating a letter walks through
    // the options that start with it instead of sticking on the first.
    const from = open ? cursor : selected;
    const hit = options
      .map((_, offset) => (from + 1 + offset) % options.length)
      .find((index) => {
        const option = options[index];
        return (
          option !== undefined &&
          option.disabled !== true &&
          option.label.toLowerCase().startsWith(prefix)
        );
      });
    if (hit === undefined) return;
    if (open) setCursor(hit);
    else commit(hit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled === true) return;
    const { key } = event;

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openList();
        return;
      }
    } else {
      switch (key) {
        case "ArrowDown":
          event.preventDefault();
          setCursor((at) => step(at, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          setCursor((at) => step(at, -1));
          return;
        case "Home":
          event.preventDefault();
          setCursor(step(-1, 1));
          return;
        case "End":
          event.preventDefault();
          setCursor(step(options.length, -1));
          return;
        case "Enter":
        case " ":
          event.preventDefault();
          commit(cursor);
          return;
        case "Tab":
          // Tab means "done here", not "take this one".
          setOpen(false);
          return;
      }
    }

    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      typeahead(key);
    }
  };

  return (
    <>
      <button
        ref={fieldRef}
        id={id}
        type="button"
        className={cx("ui-dropdown", className)}
        data-variant={variant}
        role="combobox"
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid === true ? true : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(cursor) : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="ui-dropdown-value">
          {current === undefined ? (
            placeholder === undefined ? null : (
              <b className="ui-dropdown-label ui-dropdown-empty">{placeholder}</b>
            )
          ) : (
            <>
              {current.icon === undefined ? null : (
                <span className="ui-dropdown-icon" aria-hidden="true">
                  <Icon name={current.icon} size={15} />
                </span>
              )}
              <b className="ui-dropdown-label" lang={current.lang}>
                {current.label}
              </b>
              {current.detail === undefined ? null : (
                <span className="ui-dropdown-detail">{current.detail}</span>
              )}
            </>
          )}
        </span>
        <span className="ui-dropdown-caret" aria-hidden="true">
          <Icon name="caret" size={14} />
        </span>
        {/* Inside the button, so the field is one element among its siblings and
            a parent's `:last-child` or `space-y-*` rule sees nothing else. A
            hidden input is not interactive, so it is valid there, and it still
            belongs to the form around the button. */}
        {name === undefined ? null : <input type="hidden" name={name} value={value} disabled={disabled} />}
      </button>

      {open
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              className="ui-dropdown-list"
              role="listbox"
              aria-label={label}
              // Nothing in the list takes focus, so a press on it (a disabled
              // option, say) would drop focus on <body> and stop the arrows.
              onMouseDown={(event) => event.preventDefault()}
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  className="ui-dropdown-option"
                  lang={option.lang}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled === true ? true : undefined}
                  data-on={index === cursor ? "" : undefined}
                  // `mousemove`, not `mouseenter`: the list can open under a
                  // still pointer, and the cursor should stay where the
                  // keyboard put it until the hand actually moves.
                  onMouseMove={() => {
                    if (option.disabled !== true) setCursor(index);
                  }}
                  onClick={() => commit(index)}
                >
                  <span className="ui-dropdown-tick" aria-hidden="true">
                    {option.value === value ? <Icon name="tick" size={14} /> : null}
                  </span>
                  {option.icon === undefined ? null : (
                    <span className="ui-dropdown-icon" aria-hidden="true">
                      <Icon name={option.icon} size={15} />
                    </span>
                  )}
                  <span className="ui-dropdown-option-text">
                    <b className="ui-dropdown-option-label">{option.label}</b>
                    {option.detail === undefined ? null : (
                      <span className="ui-dropdown-option-detail">{option.detail}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
