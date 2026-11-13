"use client";

import { useCallback, useEffect, type ReactNode } from "react";

import { Scrim } from "@/components/primitives/Scrim";
import { useContextMenuPolicy } from "@/hooks/useContextMenuPolicy";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export interface AppShellProps {
  /** The persistent servers and messages column; part of the rail drawer on phones. */
  serverRail: ReactNode;
  rail: ReactNode;
  room: ReactNode;
  roster: ReactNode;
  /** Below 768px the rail is a drawer; above that the CSS ignores this. */
  railOpen: boolean;
  onRailOpenChange: (open: boolean) => void;
  rosterOpen: boolean;
  onRosterOpenChange: (open: boolean) => void;
  /** Cinema mode: the roster steps aside and the stage takes its width. */
  stageFull?: boolean;
  onExitStageFull?: () => void;
  /**
   * The messages side of the app is showing. A conversation has no channel
   * roster, so the grid collapses that track; the width belongs to the grid,
   * which is why this is a class on it and not a prop on the panel.
   */
  dmSpace?: boolean;
}

/**
 * The `.app` grid, plus what belongs to the layout rather than to a panel:
 * which drawers are open, and the scrim over the room while one is.
 *
 * The narrow roster at 1024px and up with the list closed is deliberately not
 * a state class: the CSS expresses it as `.app:not(.roster-open)` inside a
 * media query, and a class named for it would collide with the `.roster-mini`
 * element rule and hide the whole grid.
 */
export function AppShell({
  serverRail,
  rail,
  room,
  roster,
  railOpen,
  onRailOpenChange,
  rosterOpen,
  onRosterOpenChange,
  stageFull,
  onExitStageFull,
  dmSpace,
}: AppShellProps) {
  useContextMenuPolicy();

  const rosterIsDrawer = useMediaQuery("(max-width: 1023px)", false);
  const railIsDrawer = useMediaQuery("(max-width: 767px)", false);
  const scrimShown = (rosterIsDrawer && rosterOpen) || (railIsDrawer && railOpen);

  const closeDrawers = useCallback(() => {
    // From 1024px the roster is a grid track, not a drawer, so it stays.
    if (rosterIsDrawer) onRosterOpenChange(false);
    onRailOpenChange(false);
  }, [rosterIsDrawer, onRosterOpenChange, onRailOpenChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        // The signed-in shell is an application surface, not a document: Tab
        // must not walk through the controls behind it. A modal keeps its
        // own focus trap, so it is left to handle the key.
        if (!document.querySelector('[role="dialog"][aria-modal="true"]')) {
          event.preventDefault();
        }
        return;
      }
      if (event.key !== "Escape") return;
      closeDrawers();
      if (stageFull) onExitStageFull?.();
    };
    // On `window`, so a layer on the shared stack, which listens on `document`,
    // takes Escape before it gets here and closes only itself.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDrawers, stageFull, onExitStageFull]);

  const className = [
    "app",
    rosterOpen && "roster-open",
    railOpen && "rail-open",
    stageFull && "stage-full",
    dmSpace && "dm-space",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className={className}>
        {serverRail}
        {rail}
        {room}
        {roster}
      </div>
      <Scrim show={scrimShown} onDismiss={closeDrawers} />
    </>
  );
}
