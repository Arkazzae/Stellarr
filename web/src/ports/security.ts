import type { AccountSecurity, MfaChallenge, OwnSession } from "@/lib/api/types";

export type { AccountSecurity, OwnSession, SecurityEvent, TrustedDevice } from "@/lib/api/types";

/**
 * The signed-in account's second factor. A change to it needs proof: a recent
 * second factor once the account has one, or the password for the first.
 * A refusal comes back as a 403, and the caller asks for that proof and tries
 * again.
 */
export interface AccountSecurityPort {
  get(): Promise<AccountSecurity>;
  /** Opens the setup of another method; the steps then run on the sign-in challenge port. */
  startEnrollment(password?: string): Promise<MfaChallenge>;
  /** A challenge whose completion counts as a fresh proof for the next few minutes. */
  startReverification(): Promise<MfaChallenge>;
  removeMethod(methodId: string, password?: string): Promise<void>;
  /** The new codes, shown once; the old ones stop working. */
  regenerateRecoveryCodes(password?: string): Promise<string[]>;
  revokeTrustedDevice(deviceId: string): Promise<void>;
  /** The account's signed-in devices, newest activity first. */
  listSessions(): Promise<OwnSession[]>;
  /** Signs another device out at once, live connections included. */
  revokeSession(sessionId: string): Promise<void>;
  revokeOtherSessions(): Promise<void>;
}
