import { t } from "@/i18n";
import type { CockpitRuntimeSample } from "@/lib/api";

/** Days and hours are left out when zero; minutes are always shown. */
export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [t("runtime.uptime.minutes", { value: minutes })];
  if (hours) parts.unshift(t("runtime.uptime.hours", { value: hours }));
  if (days) parts.unshift(t("runtime.uptime.days", { value: days }));
  return parts.join(" ");
}

/** One bar per minute of the last hour. */
export const SLOTS = 60;
export const MINUTE_MS = 60_000;

export type SlotState = "up" | "down" | "none";

/** The samples of each minute of the hour that ends at the last sample, oldest minute first. */
export function minuteSlots(history: readonly CockpitRuntimeSample[]): { end: number; slots: CockpitRuntimeSample[][] } {
  const slots: CockpitRuntimeSample[][] = Array.from({ length: SLOTS }, () => []);
  const last = history.at(-1);
  if (!last) return { end: Date.now(), slots };
  const end = Date.parse(last.at);
  for (const sample of history) {
    const index = SLOTS - 1 - Math.floor((end - Date.parse(sample.at)) / MINUTE_MS);
    if (index >= 0 && index < SLOTS) slots[index]!.push(sample);
  }
  return { end, slots };
}

/** The share of minutes with samples in which the service was up, or null without any. */
export function uptimeShare(states: readonly SlotState[]): number | null {
  const known = states.filter((state) => state !== "none");
  if (known.length === 0) return null;
  return (known.filter((state) => state === "up").length / known.length) * 100;
}
