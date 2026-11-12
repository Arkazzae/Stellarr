"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type {
  Account,
  AccountPatch,
  ImageKind,
  EmailChangeResult,
  PasswordChangeResult,
  UserPreferences,
} from "@/ports";

import { usePorts } from "./PortsProvider";

export interface AccountValue {
  account: Account;
  preferences: UserPreferences;
  update: (patch: AccountPatch) => Promise<void>;
  setPreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<PasswordChangeResult>;
  requestEmailChange: (email: string, password: string) => Promise<EmailChangeResult>;
  /** Uploads the picture and puts the resulting URL on the account in one step. */
  setImage: (kind: ImageKind, file: File) => Promise<void>;
  removeImage: (kind: ImageKind) => Promise<void>;
}

const AccountContext = createContext<AccountValue | null>(null);

/**
 * The signed-in person's own account and preferences.
 *
 * Separate from `SessionProvider`: that one answers "am I signed in" and
 * settles once, while the account changes all session and must reach every
 * list that shows your face. It depends on the ports alone, so it can sit
 * wherever the settings dialog and the shell both reach it.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { account: port } = usePorts();

  const account = useSyncExternalStore(port.onChanged, port.getAccount, port.getAccount);
  const preferences = useSyncExternalStore(
    port.onChanged,
    port.getPreferences,
    port.getPreferences,
  );

  // The attribute is what the style sheets key on, so the preference has to
  // reach the document root and not only the components that read it.
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.reducedMotion) root.dataset.reducedMotion = "true";
    else delete root.dataset.reducedMotion;
    return () => {
      delete root.dataset.reducedMotion;
    };
  }, [preferences.reducedMotion]);

  const value = useMemo<AccountValue>(
    () => ({
      account,
      preferences,
      update: (patch) => port.update(patch),
      setPreferences: (patch) => port.setPreferences(patch),
      changePassword: (current, next) => port.changePassword(current, next),
      requestEmailChange: (email, password) => port.requestEmailChange(email, password),
      async setImage(kind, file) {
        const url = await port.uploadImage(kind, file);
        await port.update(kind === "avatar" ? { avatarUrl: url } : { bannerUrl: url });
      },
      // `null` is the removal, which is why the patch cannot simply omit the key.
      removeImage: (kind) =>
        port.update(kind === "avatar" ? { avatarUrl: null } : { bannerUrl: null }),
    }),
    [account, preferences, port],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext(): AccountValue {
  const value = useContext(AccountContext);
  if (value === null) {
    throw new Error("useAccount must be used inside <AccountProvider>");
  }
  return value;
}
