import type { IconName } from "@stellarr/ui/icons";
import type { MessageKey } from "@/i18n";

/**
 * The panes of the user settings dialog. The keys are stored by the callers
 * that open it on a given pane, so they are not renamed with the labels.
 */
export type UserSettingsPaneKey =
  | "konto"
  | "bezpieczenstwo"
  | "prywatnosc"
  | "wyglad"
  | "jezyk"
  | "powiadomienia"
  | "glos"
  | "skroty"
  | "zaawansowane";

interface UserSettingsPane {
  icon: IconName;
  title: MessageKey;
  /** The sentence under the title in the dialog's bar. */
  detail: MessageKey;
}

export const USER_SETTINGS_PANES: Record<UserSettingsPaneKey, UserSettingsPane> = {
  konto: {
    icon: "at",
    title: "settings.account.title",
    detail: "settings.account.detail",
  },
  bezpieczenstwo: {
    icon: "lock",
    title: "settings.security.title",
    detail: "settings.security.detail",
  },
  prywatnosc: {
    icon: "shield",
    title: "settings.privacy.title",
    detail: "settings.privacy.detail",
  },
  wyglad: {
    icon: "sparkle",
    title: "settings.appearance.title",
    detail: "settings.appearance.detail",
  },
  jezyk: {
    icon: "language",
    title: "settings.language.title",
    detail: "settings.language.detail",
  },
  powiadomienia: {
    icon: "bell",
    title: "settings.notifications.title",
    detail: "settings.notifications.detail",
  },
  glos: {
    icon: "mic",
    title: "settings.voice.title",
    detail: "settings.voice.detail",
  },
  skroty: {
    icon: "sliders",
    title: "settings.shortcuts.title",
    detail: "settings.shortcuts.detail",
  },
  zaawansowane: {
    icon: "code",
    title: "settings.advanced.title",
    detail: "settings.advanced.detail",
  },
};

/**
 * Three groups, in the order someone goes looking: who you are, what the app
 * does while you use it, and what most people open once. The theme sits under
 * the app rather than under a server, because a person chooses it for a
 * device and a server's settings would give one preference two owners.
 */
export const USER_SETTINGS_GROUPS: readonly {
  caption: MessageKey;
  panes: readonly UserSettingsPaneKey[];
}[] = [
  {
    caption: "settings.group.account",
    panes: ["konto", "bezpieczenstwo", "prywatnosc"],
  },
  {
    caption: "settings.group.app",
    panes: ["wyglad", "jezyk", "powiadomienia", "glos"],
  },
  { caption: "settings.group.other", panes: ["skroty", "zaawansowane"] },
];

/**
 * Scrolls the settings tab bar just far enough to bring `item` fully into view.
 *
 * The offset is rounded away from the current position, so a fractional
 * layout never leaves a pixel of the tab clipped.
 */
export function revealSettingsNavItem(
  container: HTMLElement,
  item: HTMLElement,
): void {
  const view = container.getBoundingClientRect();
  const tab = item.getBoundingClientRect();

  let delta = 0;
  if (tab.left < view.left) delta = tab.left - view.left;
  else if (tab.right > view.right) delta = tab.right - view.right;
  if (delta === 0) return;

  const target = container.scrollLeft + delta;
  container.scrollTo?.({
    left: delta < 0 ? Math.floor(target) : Math.ceil(target),
    behavior: "auto",
  });
}
