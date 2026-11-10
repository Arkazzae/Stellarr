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
  useAccountContext as useAccount,
  type AccountValue,
} from "./AccountProvider";
export {
  useDirectoryContext as useDirectory,
  type DirectoryValue,
} from "./DirectoryProvider";
export { useEmoji, type EmojiValue } from "./EmojiProvider";
export {
  useLanguage,
  type InterfaceLocale,
  type LanguageSettings,
  type LanguageValue,
  type TranslationTargetLanguage,
} from "./LanguageProvider";
export {
  useNotificationContext as useNotifications,
  type NotificationValue,
} from "./NotificationProvider";
export { usePorts, useRuntime } from "./PortsProvider";
export {
  useProfileContext as useProfile,
  type ProfileValue,
} from "./ProfileProvider";
export {
  useSessionContext as useSession,
  type SessionPhase,
  type SessionValue,
} from "./SessionProvider";
export { useTheme } from "./ThemeProvider";
export {
  useUiContext as useUi,
  type ModalKey,
  type Space,
  type UiValue,
} from "./UiProvider";
export { useVoiceContext as useVoice, type VoiceValue } from "./VoiceProvider";
