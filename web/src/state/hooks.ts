/**
 * The hooks that containers and components use.
 *
 * Each provider exports its hook under a long `use*Context` name; this file
 * gathers the short names in the one place the rest of the app imports from.
 * It is the only barrel in `src/state`, and it re-exports hooks and their value
 * types, never the providers, which are composed once in the root layout and
 * in `AppContainer`.
 */

export {
  useLanguage,
  type InterfaceLocale,
  type LanguageSettings,
  type LanguageValue,
  type TranslationTargetLanguage,
} from "./LanguageProvider";
