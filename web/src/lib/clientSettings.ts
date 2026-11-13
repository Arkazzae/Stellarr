import { normaliseTheme, type ThemePreference } from "@/design/themes";
import { isSupportedLocale, type InterfaceLocale, type LanguageSettings } from "@/i18n";
import { KEYBIND_STORAGE_VERSION, parseKeybindings, type Keybindings } from "@/lib/keybinds";
import { SETTINGS_VERSION, parseVoiceSettings, type VoiceSettings } from "@/lib/voice/settings";

/**
 * How each of the client's own settings travels to the account and back.
 *
 * Every section goes up whole and comes back through the same validation the
 * device's own storage gets, because another build, older or newer, may have
 * written it. A section from another storage version is not read at all
 * (`null`): guessing at it would reset the person's settings to defaults.
 */

type Wire = Record<string, unknown>;

/** JSON with sorted keys, so two equal settings always compare equal as text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}

export function appearanceToWire(theme: ThemePreference): Wire {
  return { ...theme };
}

export function appearanceFromWire(value: Wire): ThemePreference {
  return normaliseTheme(value);
}

/**
 * The synced half of the language settings. Automatic translation stays on
 * the device: it fetches a model for every visible message, and a switch
 * flipped on one computer should not start a download on another. The
 * interface language goes up only when the person chose it, so the account
 * never pins them to whatever the instance offered first.
 */
export function languageToWire(
  settings: Pick<LanguageSettings, "chatTranslationEnabled" | "chatTranslationTargetLanguage">,
  chosenLocale: InterfaceLocale | undefined,
): Wire {
  return {
    ...(chosenLocale === undefined ? {} : { locale: chosenLocale }),
    chatTranslationEnabled: settings.chatTranslationEnabled,
    chatTranslationTargetLanguage: settings.chatTranslationTargetLanguage,
  };
}

export function languageFromWire(value: Wire): Partial<LanguageSettings> {
  const patch: Partial<LanguageSettings> = {};
  if (isSupportedLocale(value["locale"])) patch.locale = value["locale"];
  if (typeof value["chatTranslationEnabled"] === "boolean") {
    patch.chatTranslationEnabled = value["chatTranslationEnabled"];
  }
  if (isSupportedLocale(value["chatTranslationTargetLanguage"])) {
    patch.chatTranslationTargetLanguage = value["chatTranslationTargetLanguage"];
  }
  return patch;
}

/** The same envelope the device stores, so one parser reads both. */
export function keybindsToWire(bindings: Keybindings): Wire {
  return { version: KEYBIND_STORAGE_VERSION, bindings };
}

export function keybindsFromWire(value: Wire): Keybindings | null {
  return value["version"] === KEYBIND_STORAGE_VERSION ? parseKeybindings(value) : null;
}

/**
 * What stays with the machine: the devices are this computer's own, and the
 * speech sensitivity already has an account field of its own.
 */
const VOICE_DEVICE_ONLY = ["inputDeviceId", "outputDeviceId", "videoDeviceId", "vadSensitivity"] as const;

export function voiceToWire(settings: VoiceSettings): Wire {
  const wire: Wire = { ...settings };
  for (const key of VOICE_DEVICE_ONLY) delete wire[key];
  return wire;
}

/** The account's voice settings laid over this device's own, as a patch. */
export function voiceFromWire(value: Wire, current: VoiceSettings): Partial<VoiceSettings> | null {
  if (value["version"] !== SETTINGS_VERSION) return null;
  const local: Wire = {};
  for (const key of VOICE_DEVICE_ONLY) local[key] = current[key];
  const { version: _version, ...merged } = parseVoiceSettings({ ...value, ...local });
  return merged;
}
