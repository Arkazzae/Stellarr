"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { DialogClose } from "@/components/primitives/DialogClose";

export interface SettingsShellItem<K extends string> {
  key: K;
  label: string;
  icon: IconName;
  danger?: boolean;
}

export interface SettingsShellGroup<K extends string> {
  caption: string;
  items: readonly SettingsShellItem<K>[];
}

export interface SettingsShellProps<K extends string> {
  /** The id the surrounding `Modal` is labelled by; it lands on the brand's name. */
  titleId: string;
  /** What these settings belong to, at the top of the side panel. */
  brand: {
    name: string;
    detail: string;
    /** A fuller accessible name for the dialog than the visible one. */
    label?: string;
  };
  /** The bar above the content: the current pane's name and the sentence under it. */
  title: string;
  detail: string;
  closeLabel: string;
  onClose: () => void;
  /** False while a request is in flight that closing would orphan. */
  closable?: boolean;
  navLabel: string;
  groups: readonly SettingsShellGroup<K>[];
  active: K;
  onSelect: (key: K) => void;
  className?: string;
  /** The current pane. */
  children: ReactNode;
}

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * The layout every settings dialog shares: a side panel with the owner's name
 * and the captioned items, a fixed bar naming the current pane with the way
 * out, and one scrolling column for the pane. The caller wraps it in a `Modal`
 * and keeps the state, so each dialog decides what reopening resets.
 */
export function SettingsShell<K extends string>({
  titleId,
  brand,
  title,
  detail,
  closeLabel,
  onClose,
  closable = true,
  navLabel,
  groups,
  active,
  onSelect,
  className,
  children,
}: SettingsShellProps<K>) {
  const panesRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // The panes share one scroll container; without this the second pane
    // opens as far down as the first was scrolled.
    if (panesRef.current) panesRef.current.scrollTop = 0;
    // `Modal` enters one animation frame after it mounts. Waiting one more
    // means a directly opened pane has real geometry before its tab in the
    // horizontal mobile navigation is brought into view.
    let revealFrame = 0;
    const enterFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        navRef.current
          ?.querySelector<HTMLElement>(".sv-item.on")
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });
    return () => {
      cancelAnimationFrame(enterFrame);
      cancelAnimationFrame(revealFrame);
    };
  }, [active]);

  return (
    <div className={classes("sv", className)}>
      {/* First in the DOM as well as on screen. On a phone the close action
          must not sit below two navigation bands, and keyboard focus should
          follow the order a reader sees. */}
      <div className="sv-bar">
        <div className="sv-bar-txt">
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
        <DialogClose label={closeLabel} onClose={onClose} disabled={!closable} />
      </div>
      <aside className="sv-nav">
        <div className="sv-brand">
          <span className="sv-brand-txt">
            <b id={titleId} aria-label={brand.label}>
              {brand.name}
            </b>
            <span>{brand.detail}</span>
          </span>
        </div>
        <nav className="sv-nav-scroll" aria-label={navLabel} ref={navRef}>
          {groups.map((group) => (
            // A fragment, not a wrapper: `.sv-nav-scroll .sv-cap:first-child`
            // only means "the first caption" while the captions and the items
            // are flat siblings.
            <Fragment key={group.caption}>
              <div className="sv-cap">{group.caption}</div>
              {group.items.map((item) => {
                const on = item.key === active;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={classes("sv-item", on && "on", item.danger && "danger")}
                    data-pane={item.key}
                    aria-current={on ? "page" : undefined}
                    onClick={() => onSelect(item.key)}
                  >
                    <span className="sv-ico" aria-hidden="true">
                      <Icon name={item.icon} size={18} />
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>
      </aside>
      <div className="sv-main">
        <div className="sv-panes" ref={panesRef}>
          {/* Keyed by pane, which replays the `.sv-pane.on` entrance on every
              switch and drops whatever the last pane kept in local state. */}
          <section className="sv-pane on" data-pane={active} key={active}>
            {children}
          </section>
        </div>
      </div>
    </div>
  );
}
