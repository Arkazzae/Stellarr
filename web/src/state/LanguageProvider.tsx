"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  isSupportedLocale,
  translateMessage,
  type InterfaceLocale,
  type LanguageSettings,
  type MessageKey,
  type MessageValues,
} from "@/i18n";

export type { InterfaceLocale, LanguageSettings, TranslationTargetLanguage } from "@/i18n";

export interface LanguageValue extends LanguageSettings {
  update: (patch: Partial<LanguageSettings>) => void;
  /** Short component copy in both languages, without a catalog entry. */
  text: (polish: string, english: string) => string;
  /** Typed catalog lookup for copy shared across surfaces. */
  t: (key: MessageKey, values?: MessageValues) => string;
}

const STORAGE_KEY = "stellarr_language_settings";
/** The server layout reads this cookie, so the first paint is already in the right language. */
const COOKIE_KEY = "stellarr_locale";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const DEFAULTS: LanguageSettings = {
  locale: "pl",
  chatTranslationEnabled: false,
  chatAutoTranslateEnabled: false,
  chatTranslationTargetLanguage: "en",
};

function readStored(fallbackLocale: InterfaceLocale): LanguageSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS, locale: fallbackLocale };
    const stored = JSON.parse(raw) as Partial<LanguageSettings>;
    const translationEnabled = stored.chatTranslationEnabled === true;
    return {
      locale: isSupportedLocale(stored.locale) ? stored.locale : fallbackLocale,
      chatTranslationEnabled: translationEnabled,
      chatAutoTranslateEnabled: translationEnabled && stored.chatAutoTranslateEnabled === true,
      chatTranslationTargetLanguage: isSupportedLocale(stored.chatTranslationTargetLanguage)
        ? stored.chatTranslationTargetLanguage
        : DEFAULTS.chatTranslationTargetLanguage,
    };
  } catch {
    return { ...DEFAULTS, locale: fallbackLocale };
  }
}

function persist(settings: LanguageSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A private or locked-down browser may refuse storage. The choice still
    // holds for this tab, and translation keeps working.
  }
}

function rememberLocale(locale: InterfaceLocale): void {
  document.cookie = `${COOKIE_KEY}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

function applyPatch(current: LanguageSettings, patch: Partial<LanguageSettings>): LanguageSettings {
  const next = { ...current, ...patch };
  const pairChanged =
    patch.chatTranslationTargetLanguage !== undefined &&
    patch.chatTranslationTargetLanguage !== current.chatTranslationTargetLanguage;
  // A new language pair needs its own model, so auto-translation stays off
  // until the user sees that model is ready and turns it on again.
  if (!next.chatTranslationEnabled || pairChanged) next.chatAutoTranslateEnabled = false;
  return next;
}

// What a component sees when no provider is mounted, as in most component
// tests: Polish, and changes go nowhere.
const fallback: LanguageValue = {
  ...DEFAULTS,
  update: () => undefined,
  text: (polish) => polish,
  t: (key, values) => translateMessage("pl", key, values),
};

const LanguageContext = createContext<LanguageValue>(fallback);

export function LanguageProvider({
  children,
  initialLocale = "pl",
}: {
  children: ReactNode;
  initialLocale?: InterfaceLocale;
}) {
  // The locale from the cookie is the same on the server and in the first
  // client render. Translation preferences live only on this device, so they
  // are read after hydration.
  const [settings, setSettings] = useState<LanguageSettings>({
    ...DEFAULTS,
    locale: initialLocale,
  });
  // Lets `update` see changes made earlier in the same tick, before React
  // has re-rendered with them.
  const latest = useRef(settings);

  const commit = useCallback((next: LanguageSettings) => {
    latest.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = readStored(initialLocale);
      commit(stored);
      if (stored.locale !== initialLocale) rememberLocale(stored.locale);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialLocale, commit]);

  useEffect(() => {
    document.documentElement.lang = settings.locale;
    document.documentElement.dataset.locale = settings.locale;
  }, [settings.locale]);

  const update = useCallback(
    (patch: Partial<LanguageSettings>) => {
      const current = latest.current;
      const next = applyPatch(current, patch);
      commit(next);
      persist(next);
      if (next.locale !== current.locale) rememberLocale(next.locale);
    },
    [commit],
  );

  const { locale } = settings;
  const text = useCallback(
    (polish: string, english: string) => (locale === "en" ? english : polish),
    [locale],
  );
  const t = useCallback(
    (key: MessageKey, values?: MessageValues) => translateMessage(locale, key, values),
    [locale],
  );

  const value = useMemo<LanguageValue>(
    () => ({ ...settings, update, text, t }),
    [settings, update, text, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  return useContext(LanguageContext);
}
