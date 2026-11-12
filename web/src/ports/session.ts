import type {
  AuthResult,
  Bootstrap,
  LoginInput,
  MfaChallenge,
  MfaCompletion,
  MfaEnrollment,
  MfaVerifyInput,
} from "@/lib/api/types";

export type {
  AuthResult,
  MfaChallenge,
  MfaCompletion,
  MfaEnrollment,
  MfaMethod,
  MfaMethodType,
  MfaPurpose,
  MfaVerifyInput,
} from "@/lib/api/types";

export interface RegistrationInput {
  username: string;
  displayName: string;
  email: string;
  password: string;
  inviteCode?: string;
  initialServer?: {
    name: string;
    description: string;
    textChannelName: string;
    voiceChannelName: string;
  };
}

/**
 * The second half of a sign-in: answering a challenge, or setting up the
 * first method when the account has none. Every call names the challenge the
 * first step returned.
 */
export interface SignInChallengePort {
  /** The challenge this browser left unfinished, or null when there is none. */
  pending(): Promise<MfaChallenge | null>;
  cancel(): Promise<void>;
  verify(input: MfaVerifyInput): Promise<MfaCompletion>;
  /** Resolves with how long to wait before another code may be sent. */
  sendEmailCode(challengeId: string, methodId?: string): Promise<{ retryAfterSeconds: number }>;
  startTotp(challengeId: string, name: string): Promise<MfaEnrollment>;
  confirmTotp(input: {
    challengeId: string;
    methodId: string;
    code: string;
    name: string;
    rememberDevice?: boolean;
  }): Promise<MfaCompletion>;
  /** Sends the first code to the account's email address. */
  startEmail(challengeId: string, name: string): Promise<{ retryAfterSeconds: number }>;
  confirmEmail(input: {
    challengeId: string;
    code: string;
    name: string;
    rememberDevice?: boolean;
  }): Promise<MfaCompletion>;
  /** Trades an operator's recovery credential for the challenge that sets up new security. */
  /** `keepSignedIn` is the choice made on the sign-in form this recovery continues. */
  redeemRecovery(credential: string, keepSignedIn?: boolean): Promise<MfaChallenge>;
}

/** Signing in and out, and the one payload the app boots from. */
export interface SessionPort {
  needsServerSetup(): Promise<boolean>;
  bootstrap(): Promise<Bootstrap>;
  login(input: LoginInput): Promise<AuthResult>;
  register(input: RegistrationInput): Promise<AuthResult>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  logout(): Promise<void>;
  /** Whether the server still knows this browser's session. */
  check(): Promise<boolean>;
  challenge: SignInChallengePort;
}
