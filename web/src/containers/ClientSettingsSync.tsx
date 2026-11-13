"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  appearanceFromWire,
  appearanceToWire,
  defaultWire,
  keybindsFromWire,
  keybindsToWire,
  languageFromWire,
  languageToWire,
  stableJson,
  voiceFromWire,
  voiceToWire,
} from "@/lib/clientSettings";
import {
  CLIENT_SETTINGS_SECTIONS,
  type AccountPort,
  type ClientSettingsSection,
  type ClientSettingsSnapshot,
} from "@/ports";
import {
  useAccount,
  useKeybinds,
  useLanguage,
  usePorts,
  useTheme,
  type KeybindValue,
  type LanguageValue,
} from "@/state/hooks";

/**
 * Long enough that dragging a slider or the colour picker sends one request,
 * short enough that closing the tab right after a change rarely beats it.
 */
export const SAVE_DELAY_MS = 500;

type Wire = Record<string, unknown>;
type Sections<T> = Partial<Record<ClientSettingsSection, T>>;

/**
 * Sections changed here that the account has not confirmed yet. Kept in the
 * browser, so a change that never reached the server (offline, a closed tab)
 * is sent at the next sign-in instead of being overwritten by the older value
 * the account still holds.
 */
const pendingKey = (userId: string) => `stellarr.settings.pending.${encodeURIComponent(userId)}`;

function readPending(userId: string): Set<ClientSettingsSection> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(pendingKey(userId)) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? CLIENT_SETTINGS_SECTIONS.filter((section) => stored.includes(section))
        : [],
    );
  } catch {
    return new Set();
  }
}

function setPending(userId: string, section: ClientSettingsSection, pending: boolean): void {
  try {
    const sections = readPending(userId);
    if (pending) sections.add(section);
    else sections.delete(section);
    if (sections.size === 0) window.localStorage.removeItem(pendingKey(userId));
    else window.localStorage.setItem(pendingKey(userId), JSON.stringify([...sections]));
  } catch {
    // Without storage a change still goes up; only the retry after a failure is lost.
  }
}

/** One signed-in account's sync: what it holds, what is waiting to go up. */
interface Run {
  userId: string;
  port: AccountPort;
  /** Set once the account's own values have been read and applied. */
  loaded: boolean;
  disposed: boolean;
  /** What the account holds or is about to; a local value equal to it is not sent. */
  synced: Sections<string>;
  waiting: Sections<Wire>;
  timers: Sections<number>;
  /** One request per section at a time, in the order they were made. */
  queue: Sections<Promise<void>>;
}

function send(run: Run, section: ClientSettingsSection): void {
  const wire = run.waiting[section];
  window.clearTimeout(run.timers[section]);
  if (wire === undefined) return;
  delete run.waiting[section];
  const previous = run.queue[section] ?? Promise.resolve();
  run.queue[section] = previous
    .then(() => run.port.saveClientSettings(section, wire))
    .then(
      () => {
        if (run.waiting[section] === undefined) setPending(run.userId, section, false);
      },
      () => {
        // Still marked pending: the next change, or the next sign-in, sends it.
        delete run.synced[section];
      },
    );
}

function noteChange(run: Run | null, section: ClientSettingsSection, wire: Wire): void {
  if (run === null || !run.loaded || run.disposed) return;
  const json = stableJson(wire);
  // Equal to the account's: just applied from it, or already sent.
  if (json === run.synced[section]) return;
  run.synced[section] = json;
  run.waiting[section] = wire;
  setPending(run.userId, section, true);
  window.clearTimeout(run.timers[section]);
  run.timers[section] = window.setTimeout(() => send(run, section), SAVE_DELAY_MS);
}

/** What applying needs, read at the moment the account answers. */
interface Local {
  theme: ReturnType<typeof useTheme>;
  language: LanguageValue;
  keybinds: KeybindValue;
  voiceSettings: ReturnType<typeof usePorts>["voiceSettings"];
}

function localWire(local: Local, section: ClientSettingsSection): Wire {
  switch (section) {
    case "appearance":
      return appearanceToWire(local.theme.theme);
    case "language":
      return languageToWire(local.language, local.language.chosenLocale());
    case "keybinds":
      return keybindsToWire(local.keybinds.bindings);
    case "voice":
      return voiceToWire(local.voiceSettings.getSnapshot());
  }
}

/**
 * Puts the account's value of one section on this device and returns the
 * section as it will then read here, or null when the value is from another
 * version of the client and is left alone, neither applied nor replaced.
 */
function applySection(local: Local, section: ClientSettingsSection, stored: Wire): Wire | null {
  switch (section) {
    case "appearance": {
      const theme = appearanceFromWire(stored);
      local.theme.update(theme);
      return appearanceToWire(theme);
    }
    case "language": {
      const patch = languageFromWire(stored);
      if (Object.keys(patch).length > 0) local.language.update(patch);
      return languageToWire(
        { ...local.language, ...patch },
        patch.locale ?? local.language.chosenLocale(),
      );
    }
    case "keybinds": {
      const bindings = keybindsFromWire(stored);
      if (bindings === null) return null;
      local.keybinds.replaceBindings(stored);
      return keybindsToWire(bindings);
    }
    case "voice": {
      const patch = voiceFromWire(stored, local.voiceSettings.getSnapshot());
      if (patch === null) return null;
      local.voiceSettings.update(patch);
      return voiceToWire(local.voiceSettings.getSnapshot());
    }
  }
}

function load(run: Run, remote: ClientSettingsSnapshot, local: Local): void {
  const pending = readPending(run.userId);
  for (const section of CLIENT_SETTINGS_SECTIONS) {
    const stored = remote[section];
    // Never saved: what this device has becomes the account's, which is how
    // settings made before they followed the account carry over, unless it
    // is only the defaults (see `defaultWire`). Changed here and not
    // confirmed: this device's value is the newer one.
    if (stored === null || pending.has(section)) {
      const wire = localWire(local, section);
      const json = stableJson(wire);
      run.synced[section] = json;
      if (!pending.has(section) && json === stableJson(defaultWire(section))) continue;
      run.waiting[section] = wire;
      setPending(run.userId, section, true);
      send(run, section);
      continue;
    }
    const applied = applySection(local, section, stored);
    if (applied !== null) run.synced[section] = stableJson(applied);
  }
  run.loaded = true;
}

/**
 * Keeps the client's own settings on the account: the theme, the language,
 * the call shortcuts and the voice processing.
 *
 * The device still owns them while it runs, in the providers that apply them,
 * and keeps its own copy for the first paint and the sign-in screen. This only
 * reads the account's copy once per sign-in and lays it over the device's,
 * then sends every later change back, one section at a time.
 *
 * Rendered as a component of its own so that a dragged slider re-renders
 * nothing but this.
 */
export function ClientSettingsSync(): null {
  useClientSettingsSync();
  return null;
}

export function useClientSettingsSync(): void {
  const ports = usePorts();
  const { account } = useAccount();
  const theme = useTheme();
  const language = useLanguage();
  const keybinds = useKeybinds();
  const voice = useSyncExternalStore(
    ports.voiceSettings.subscribe,
    ports.voiceSettings.getSnapshot,
    ports.voiceSettings.getSnapshot,
  );
  const userId = account.id;
  const run = useRef<Run | null>(null);
  const local = useRef<Local>({ theme, language, keybinds, voiceSettings: ports.voiceSettings });

  // First, so that the loader below and the change effects read this render's values.
  useEffect(() => {
    local.current = { theme, language, keybinds, voiceSettings: ports.voiceSettings };
  });

  useEffect(() => {
    // Not signed in yet: the account is still the blank one.
    if (userId === "") return;
    const current: Run = {
      userId,
      port: ports.account,
      loaded: false,
      disposed: false,
      synced: {},
      waiting: {},
      timers: {},
      queue: {},
    };
    run.current = current;
    const controller = new AbortController();
    ports.account.loadClientSettings(controller.signal).then(
      (remote) => {
        if (!current.disposed) load(current, remote, local.current);
      },
      () => {
        // Offline, or a server without the sections: the device keeps its own
        // settings and nothing is sent until the next sign-in reads them.
      },
    );

    const flush = () => {
      for (const section of CLIENT_SETTINGS_SECTIONS) send(current, section);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      current.disposed = true;
      controller.abort();
      window.removeEventListener("pagehide", flush);
      for (const section of CLIENT_SETTINGS_SECTIONS) window.clearTimeout(current.timers[section]);
      if (run.current === current) run.current = null;
    };
  }, [userId, ports.account]);

  const { chatTranslationEnabled, chatTranslationTargetLanguage, locale, chosenLocale } = language;

  useEffect(() => noteChange(run.current, "appearance", appearanceToWire(theme.theme)), [theme.theme]);
  useEffect(
    () =>
      noteChange(
        run.current,
        "language",
        languageToWire({ chatTranslationEnabled, chatTranslationTargetLanguage }, chosenLocale()),
      ),
    // The locale is here for what `chosenLocale` reads, not for a value used directly.
    [locale, chatTranslationEnabled, chatTranslationTargetLanguage, chosenLocale],
  );
  useEffect(() => noteChange(run.current, "keybinds", keybindsToWire(keybinds.bindings)), [keybinds.bindings]);
  useEffect(() => noteChange(run.current, "voice", voiceToWire(voice)), [voice]);
}
