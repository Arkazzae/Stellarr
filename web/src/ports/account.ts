import type {
  ClientSettingsSection,
  ClientSettingsSnapshot,
  JoinSoundLibrary,
  UserId,
} from "@/lib/api/types";

import type { Unsubscribe } from "./chat";

/**
 * Your own account, as the user settings modal reads and writes it.
 *
 * Not part of `SessionPort`: that answers "who am I" once at boot, while this
 * is edited all session and has to notify. Not part of `ServerAdminPort`
 * either, because nothing here belongs to a server.
 */

/** The signed-in person, in full. */
export interface Account {
  id: UserId;
  username: string;
  displayName: string;
  /** Recovery address; absent on accounts created before mail support. */
  email?: string;
  /** ISO 8601. */
  createdAt: string;
  /** Absent means no upload: the card shows the built-in art chosen by id. */
  avatarUrl?: string;
  bannerUrl?: string;
  /** Short public activity line, separate from the longer bio. */
  customStatus: string;
  /** Editable fields are strings, "" when unset, never absent. */
  bio: string;
  pronouns: string;
}

export interface AccountPatch {
  displayName?: string;
  email?: string;
  customStatus?: string;
  bio?: string;
  pronouns?: string;
  /** `null` removes the picture; `undefined` leaves it alone. */
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}

/** What "change password" can answer; each maps to one sentence in the UI. */
export type PasswordChangeResult =
  | "changed"
  | "wrong-current"
  | "too-short"
  | "same-as-current"
  /** The account has a second step and the session has not passed it in the last minutes. */
  | "second-step-required";

/** What asking for a new address can answer; only "sent" mailed a link. */
export type EmailChangeResult =
  | "sent"
  | "wrong-password"
  | "second-step-required"
  | "same"
  | "taken"
  | "mail-unavailable";

/** Which picture an upload is for; the two have different size limits. */
export type ImageKind = "avatar" | "banner";

/**
 * Preferences that belong to a person rather than to a server or a device.
 *
 * The theme, the language, the shortcuts and the voice processing are absent
 * on purpose: the account keeps them too, but as the client's own sections
 * (`loadClientSettings`), which the providers that apply them read and write.
 * Listing them here as well would give one setting two owners.
 */
export interface UserPreferences {
  /** Notifications. `desktopNotifications` pops up incoming calls. */
  desktopNotifications: boolean;
  /** A mention pops up over other apps while the app is in the background. */
  mentionPopups: boolean;
  /** An incoming call rings while the app is open. */
  callRingtone: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  mentionsOnly: boolean;
  messageSound: boolean;
  joinLeaveSound: boolean;
  /** Privacy */
  allowDirectMessages: boolean;
  allowFriendRequests: boolean;
  showPresence: boolean;
  /** Advanced */
  developerMode: boolean;
  reducedMotion: boolean;
  /** Text channels whose incoming messages stay silent for this user. */
  mutedChannelIds: string[];
  /** Voice-activity sensitivity, synced between devices. */
  vadSensitivity: number;
  /**
   * The soundboard sound a voice room hears when this person walks in; `null`
   * leaves the shared arrival chime alone. An id rather than a clip, because
   * the sound belongs to a server's soundboard: nobody can greet a room with
   * audio that server never approved.
   */
  joinSoundId: string | null;
}

export interface AccountPort {
  getAccount(): Account;
  getPreferences(): UserPreferences;
  /** Fires after every mutation below. */
  onChanged(handler: () => void): Unsubscribe;

  update(patch: AccountPatch): Promise<void>;
  setPreferences(patch: Partial<UserPreferences>): Promise<void>;
  /**
   * Resolves with a result for a wrong password instead of rejecting: it is an
   * answer, not a failure, and the pane prints it as a sentence.
   */
  changePassword(current: string, next: string): Promise<PasswordChangeResult>;
  /**
   * Mails a link to the new address, after the password and, when the
   * account has one, a fresh second step. The address changes when the
   * link is opened, so the account here stays as it is until then.
   */
  requestEmailChange(email: string, password: string): Promise<EmailChangeResult>;
  /** Stores the picture and returns the URL to put on the account. */
  uploadImage(kind: ImageKind, file: File): Promise<string>;

  /**
   * Every sound this account may be announced with, grouped by the server it
   * came from. Read on demand: it is consulted while one dialog is open, and
   * it can be long.
   */
  listJoinSounds(signal?: AbortSignal): Promise<JoinSoundLibrary>;

  /**
   * The client's own settings the account keeps, so the theme, the language,
   * the shortcuts and the voice processing follow the person between devices.
   * The device still owns them while it runs; this is where they are kept.
   */
  loadClientSettings(signal?: AbortSignal): Promise<ClientSettingsSnapshot>;
  /** Replaces one section whole; the others are left as they are. */
  saveClientSettings(section: ClientSettingsSection, value: Record<string, unknown>): Promise<void>;
}

export type { ClientSettingsSection, ClientSettingsSnapshot };
export { CLIENT_SETTINGS_SECTIONS } from "@/lib/api/types";

/** The largest image the server accepts for each kind. */
export const IMAGE_LIMITS: Record<ImageKind, { maxBytes: number }> = {
  avatar: { maxBytes: 4 * 1024 * 1024 },
  banner: { maxBytes: 8 * 1024 * 1024 },
};
