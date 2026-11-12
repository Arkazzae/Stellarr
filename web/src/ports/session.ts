import type { Bootstrap, LoginInput, User } from "@/lib/api/types";

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

/** Signing in and out, and the one payload the app boots from. */
export interface SessionPort {
  needsServerSetup(): Promise<boolean>;
  bootstrap(): Promise<Bootstrap>;
  login(input: LoginInput): Promise<User>;
  register(input: RegistrationInput): Promise<User>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  logout(): Promise<void>;
}
