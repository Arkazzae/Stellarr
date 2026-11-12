import type { ApiClient } from "../client";
import { ApiError, isUnauthorized } from "../errors";
import { expectBoolean, expectRecord, unwrap } from "../expect";
import { parseBootstrap, parseUser } from "../parsers";
import { parseAuthResult } from "../securityParsers";
import {
  forgetActiveServerId,
  readActiveServerId,
  rememberActiveServerId,
} from "../transport";
import type { Bootstrap, User } from "../types";
import type { Parse } from "./http";
import { getJson, sendJson, sendVoid } from "./http";

type SessionCalls = Pick<
  ApiClient,
  | "needsServerSetup"
  | "login"
  | "register"
  | "requestPasswordReset"
  | "resetPassword"
  | "logout"
  | "session"
  | "bootstrap"
>;

const BOOTSTRAP_PATH = "/api/bootstrap";

/** An explicit null user, bare or enveloped, is an anonymous visitor. */
const parseSessionAnswer: Parse<User | null> = (value, path) => {
  const user = unwrap(value, "user");
  return user === null || user === undefined ? null : parseUser(user, path);
};

/**
 * A remembered server may have been deleted, or the account removed from it.
 * Asking once more without it lets another membership become active.
 */
async function fetchBootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  try {
    return await getJson(BOOTSTRAP_PATH, parseBootstrap, signal);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 403 ||
      readActiveServerId() === undefined
    ) {
      throw error;
    }
    forgetActiveServerId();
    return getJson(BOOTSTRAP_PATH, parseBootstrap, signal);
  }
}

export function sessionCalls(): SessionCalls {
  return {
    needsServerSetup: (signal) => getJson(
      "/api/auth/registration",
      (value, path) => expectBoolean(expectRecord(value, path), "needsServerSetup", path),
      signal,
    ),
    login: (input, signal) =>
      sendJson("POST", "/api/auth/login", input, parseAuthResult, signal),

    register: (input, signal) =>
      sendJson("POST", "/api/auth/register", input, parseAuthResult, signal),

    requestPasswordReset: (email, signal) =>
      sendVoid("POST", "/api/auth/password/forgot", { email }, signal),

    resetPassword: (token, newPassword, signal) =>
      sendVoid("POST", "/api/auth/password/reset", { token, newPassword }, signal),

    async logout() {
      try {
        await sendVoid("POST", "/api/auth/logout");
      } catch (error) {
        // A rejected logout still means the client is done with the session.
        if (!isUnauthorized(error)) throw error;
      }
    },

    async session(signal) {
      try {
        return await getJson("/api/session", parseSessionAnswer, signal);
      } catch (error) {
        // An API from before `{ user: null }` answered 401 to a visitor.
        if (isUnauthorized(error)) return null;
        throw error;
      }
    },

    async bootstrap(signal) {
      const bootstrap = await fetchBootstrap(signal);
      rememberActiveServerId(bootstrap.server.id);
      return bootstrap;
    },
  };
}
