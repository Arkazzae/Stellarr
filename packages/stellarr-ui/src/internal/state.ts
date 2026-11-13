import { useState } from "react";

interface ControllableState<T> {
  /** Set when the parent owns the value. */
  value: T | undefined;
  defaultValue: T;
  onChange?: (value: T) => void;
}

/** A value the parent may own (`value`) or leave to the component (`defaultValue`). */
export function useControllableState<T>({ value, defaultValue, onChange }: ControllableState<T>) {
  const [own, setOwn] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;

  const set = (next: T) => {
    if (!controlled) setOwn(next);
    if (!Object.is(next, current)) onChange?.(next);
  };

  return [current, set] as const;
}
