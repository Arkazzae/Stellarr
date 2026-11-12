import type { ApiClient } from "../client";
import { ApiError, statusToKind } from "../errors";
import {
  parseEmailCodeSent,
  parseMfaChallenge,
  parseMfaCompletion,
  parseMfaEnrollment,
} from "../securityParsers";
import { JSON_HEADERS, readJson, request } from "../transport";
import { getJson, sendJson, sendVoid } from "./http";

/**
 * Asks for an email code. A refusal for sending too soon carries how long to
 * wait in `Retry-After`, which the error keeps so the screen can count down.
 */
async function sendEmailCode(
  path: string,
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ retryAfterSeconds: number }> {
  const response = await request(
    path,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    signal,
  );
  if (!response.ok) {
    const seconds = Number(response.headers.get("Retry-After"));
    throw new ApiError(statusToKind(response.status), `${path} responded ${response.status}`, response.status, {
      ...(Number.isFinite(seconds) && seconds > 0 ? { details: { retryAfterSeconds: seconds } } : {}),
    });
  }
  return parseEmailCodeSent(await readJson(response, path), path);
}

type SignInCalls = Pick<
  ApiClient,
  | "pendingChallenge"
  | "cancelChallenge"
  | "verifyChallenge"
  | "sendChallengeEmailCode"
  | "startTotpEnrollment"
  | "confirmTotpEnrollment"
  | "startEmailEnrollment"
  | "confirmEmailEnrollment"
  | "redeemRecoveryCredential"
>;

/**
 * The second half of a sign-in. Each call names the challenge by id; the
 * server checks it against the HttpOnly cookie the first step set, so the id
 * alone opens nothing.
 */
export function signInCalls(): SignInCalls {
  return {
    pendingChallenge: (signal) => getJson("/api/auth/mfa/pending", parseMfaChallenge, signal),

    cancelChallenge: () => sendVoid("POST", "/api/auth/mfa/cancel"),

    verifyChallenge: (input, signal) =>
      sendJson("POST", "/api/auth/mfa/verify", input, parseMfaCompletion, signal),

    sendChallengeEmailCode: (challengeId, methodId, signal) =>
      sendEmailCode(
        "/api/auth/mfa/email/send",
        { challengeId, ...(methodId === undefined ? {} : { methodId }) },
        signal,
      ),

    startTotpEnrollment: (challengeId, name, signal) =>
      sendJson(
        "POST",
        "/api/auth/mfa/enroll/totp/start",
        { challengeId, name },
        parseMfaEnrollment,
        signal,
      ),

    confirmTotpEnrollment: (input, signal) =>
      sendJson("POST", "/api/auth/mfa/enroll/totp/confirm", input, parseMfaCompletion, signal),

    startEmailEnrollment: (challengeId, name, signal) =>
      sendEmailCode("/api/auth/mfa/enroll/email/start", { challengeId, name }, signal),

    confirmEmailEnrollment: (input, signal) =>
      sendJson("POST", "/api/auth/mfa/enroll/email/confirm", input, parseMfaCompletion, signal),

    redeemRecoveryCredential: (credential, keepSignedIn, signal) =>
      sendJson(
        "POST",
        "/api/auth/recovery/redeem",
        { credential, ...(keepSignedIn === false ? { keepSignedIn: false } : {}) },
        parseMfaChallenge,
        signal,
      ),
  };
}
