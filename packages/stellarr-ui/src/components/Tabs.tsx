"use client";

import { createContext, useContext, useId, type ComponentProps, type KeyboardEvent } from "react";

import { cx } from "../cx";
import { useControllableState } from "../internal/state";

interface TabsContextValue {
  value: string;
  select: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (context === null) throw new Error("Tabs parts must sit inside <Tabs>.");
  return context;
}

const triggerId = (baseId: string, value: string) => `${baseId}-tab-${value}`;
const panelId = (baseId: string, value: string) => `${baseId}-panel-${value}`;

/** `unstyled` leaves the look to the caller, for a strip drawn its own way. */
interface Unstyled {
  unstyled?: boolean;
}

export interface TabsProps extends Omit<ComponentProps<"div">, "defaultValue" | "dir">, Unstyled {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

/**
 * Panels that share one place, picked from a row of tabs. Only the picked
 * panel is mounted; state that has to outlive a switch lives above the tabs.
 */
export function Tabs({ value, defaultValue = "", onValueChange, unstyled, className, ...props }: TabsProps) {
  const [current, select] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const baseId = useId();

  return (
    <TabsContext.Provider value={{ value: current, select, baseId }}>
      <div className={unstyled ? className : cx("ui-tabs", className)} data-orientation="horizontal" {...props} />
    </TabsContext.Provider>
  );
}

/** The arrow keys move between tabs and pick the one they land on, Home and End jump to the ends. */
function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
  );
  const from = tabs.findIndex((tab) => tab === document.activeElement);
  if (from === -1) return;
  const to =
    event.key === "ArrowRight"
      ? (from + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (from - 1 + tabs.length) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : null;
  if (to === null) return;
  event.preventDefault();
  tabs[to]?.focus();
}

export function TabsList({ unstyled, className, onKeyDown, ...props }: ComponentProps<"div"> & Unstyled) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={unstyled ? className : cx("ui-tabs-list", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) onListKeyDown(event);
      }}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends Omit<ComponentProps<"button">, "value">, Unstyled {
  value: string;
}

export function TabsTrigger({ value, unstyled, className, disabled, onMouseDown, onFocus, ...props }: TabsTriggerProps) {
  const tabs = useTabs();
  const selected = tabs.value === value;

  return (
    <button
      type="button"
      role="tab"
      id={triggerId(tabs.baseId, value)}
      aria-selected={selected}
      aria-controls={panelId(tabs.baseId, value)}
      data-state={selected ? "active" : "inactive"}
      // One tab stop for the row: Tab enters at the picked tab, the arrows do the rest.
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      className={unstyled ? className : cx("ui-tabs-trigger", className)}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (!disabled && event.button === 0 && !event.ctrlKey) tabs.select(value);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (!selected && !disabled) tabs.select(value);
      }}
      {...props}
    />
  );
}

export interface TabsContentProps extends ComponentProps<"div">, Unstyled {
  value: string;
}

export function TabsContent({ value, unstyled, className, ...props }: TabsContentProps) {
  const tabs = useTabs();
  if (tabs.value !== value) return null;

  return (
    <div
      role="tabpanel"
      id={panelId(tabs.baseId, value)}
      aria-labelledby={triggerId(tabs.baseId, value)}
      data-state="active"
      tabIndex={0}
      className={unstyled ? className : cx("ui-tabs-content", className)}
      {...props}
    />
  );
}
