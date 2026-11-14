import type { ApiClient } from "@/lib/api/client";
import type { AccountDetails, AccountUpdateInput } from "@/lib/api/types";
import type {
  Account,
  AccountPatch,
  AccountPort,
  User,
  UserPreferences,
} from "@/ports";

/** Shown until `hydrate` has loaded the private payload. */
const BLANK_ACCOUNT: Account = {
  id: "",
  username: "",
  displayName: "",
  createdAt: new Date(0).toISOString(),
  customStatus: "",
  bio: "",
  pronouns: "",
};

const DEFAULT_PREFERENCES: UserPreferences = {
  desktopNotifications: true,
  mentionPopups: true,
  callRingtone: true,
  emailNotifications: false,
  pushNotifications: false,
  mentionsOnly: true,
  messageSound: true,
  joinLeaveSound: true,
  allowDirectMessages: true,
  allowFriendRequests: true,
  showPresence: true,
  developerMode: false,
  reducedMotion: false,
  mutedChannelIds: [],
  vadSensitivity: 60,
  joinSoundId: null,
};

const PROFILE_FIELDS = [
  "displayName",
  "email",
  "customStatus",
  "bio",
  "pronouns",
] as const satisfies readonly (keyof AccountUpdateInput)[];

export interface AccountAdapter extends AccountPort {
  /** Loads the private account payload once the public bootstrap has succeeded. */
  hydrate(user: User): Promise<void>;
}

function toAccount(details: AccountDetails): Account {
  const { preferences: _preferences, ...account } = details;
  return account;
}

/** Account state backed entirely by `/api/me`. */
export function createAccountAdapter(api: ApiClient): AccountAdapter {
  let account = BLANK_ACCOUNT;
  let preferences = DEFAULT_PREFERENCES;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const adopt = (details: AccountDetails): void => {
    account = toAccount(details);
    preferences = { ...details.preferences };
    notify();
  };

  return {
    async hydrate(user) {
      const details = await api.getAccount();
      if (details.id !== user.id) {
        throw new Error("The account response does not belong to the active session.");
      }
      adopt(details);
    },

    getAccount: () => account,
    getPreferences: () => preferences,

    onChanged(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    async update(patch: AccountPatch) {
      const profile: AccountUpdateInput = {};
      for (const field of PROFILE_FIELDS) {
        const value = patch[field];
        if (value !== undefined) profile[field] = value;
      }
      if (Object.keys(profile).length > 0) adopt(await api.updateAccount(profile));

      // A non-null image URL is never written back: the account only learns of
      // a picture from the response to `uploadImage`.
      if (patch.avatarUrl === null) adopt(await api.removeAccountImage("avatar"));
      if (patch.bannerUrl === null) adopt(await api.removeAccountImage("banner"));
    },

    async setPreferences(patch) {
      // The picker says "no arrival sound" with null, but the API reads a null
      // the same as an absent field. An empty id is how it takes the erasure.
      const input = patch.joinSoundId === null ? { ...patch, joinSoundId: "" } : patch;
      preferences = { ...(await api.updatePreferences(input)) };
      notify();
    },

    changePassword: (current, next) => api.changePassword(current, next),
    requestEmailChange: (email, password) => api.requestEmailChange(email, password),

    async uploadImage(kind, file) {
      const details = await api.uploadAccountImage(kind, file);
      adopt(details);
      return (kind === "avatar" ? details.avatarUrl : details.bannerUrl) ?? "";
    },

    listJoinSounds: (signal) => api.getJoinSoundLibrary(signal),

    loadClientSettings: (signal) => api.getClientSettings(signal),
    saveClientSettings: (section, value) => api.saveClientSettings(section, value),
  };
}
