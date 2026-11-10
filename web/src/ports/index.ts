/**
 * The only surface the UI may import.
 *
 * A component imports from `@/ports`, `@/components`, `@/design`, `@/state`
 * and `@/lib/format`. It never imports `@/lib/api`, `@/lib/realtime` or
 * `@/lib/voice`: those are transports, wired to the ports in `@/adapters`.
 */

export * from "./account";
export * from "./chat";
export type * from "./desktop";
export type * from "./directory";
export { SERVER_PERMISSION_VALUES } from "./directory";
export type * from "./friends";
export type * from "./notifications";
export type * from "./presence";
export type * from "./session";
export type * from "./soundboard";
export * from "./voice";

import type { AccountPort } from "./account";
import type { ChatPort, MessageActionsPort, TypingPort } from "./chat";
import type { DesktopPort } from "./desktop";
import type { DirectoryPort, ServerAdminPort } from "./directory";
import type { FriendsPort } from "./friends";
import type { NotificationPort } from "./notifications";
import type { ConnectionPort, PresencePort } from "./presence";
import type { SessionPort } from "./session";
import type { SoundboardPort } from "./soundboard";
import type { VoicePort, VoiceSettingsPort } from "./voice";

/** Everything the app is wired with, assembled once in `@/adapters`. */
export interface Ports {
  /** Present only in the native client; a browser has no system autostart. */
  desktop?: DesktopPort;
  session: SessionPort;
  account: AccountPort;
  chat: ChatPort;
  messageActions: MessageActionsPort;
  typing: TypingPort;
  presence: PresencePort;
  connection: ConnectionPort;
  directory: DirectoryPort;
  admin: ServerAdminPort;
  friends: FriendsPort;
  notifications: NotificationPort;
  soundboard: SoundboardPort;
  voiceSettings: VoiceSettingsPort;
  /**
   * Created per session rather than per app: voice needs the signed-in user
   * and the RTC config that `bootstrap` returns.
   */
  createVoice(options: CreateVoiceOptions): VoicePort;
}

export interface CreateVoiceOptions {
  userId: string;
  displayName: string;
}
