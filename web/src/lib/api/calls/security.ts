import type { ApiClient } from "../client";
import {
  parseAccountSecurity,
  parseMfaChallenge,
  parseRecoveryCodes,
  parseSecurityEvent,
} from "../securityParsers";
import { deleteResource, getJson, parseList, route, sendJson, sendVoid } from "./http";

type SecurityCalls = Pick<
  ApiClient,
  | "getAccountSecurity"
  | "listSecurityEvents"
  | "startMfaEnrollment"
  | "startMfaReverification"
  | "removeMfaMethod"
  | "regenerateRecoveryCodes"
  | "revokeTrustedDevice"
>;

const withPassword = (password?: string) => (password === undefined ? {} : { password });

/** The signed-in account's second factor: its methods, recovery codes, trusted devices and history. */
export function securityCalls(): SecurityCalls {
  return {
    getAccountSecurity: (signal) => getJson("/api/me/security", parseAccountSecurity, signal),

    listSecurityEvents: (signal) =>
      getJson("/api/me/security/events", parseList(parseSecurityEvent), signal),

    startMfaEnrollment: (password, signal) =>
      sendJson(
        "POST",
        "/api/me/security/mfa/enroll/start",
        withPassword(password),
        parseMfaChallenge,
        signal,
      ),

    startMfaReverification: (signal) =>
      sendJson("POST", "/api/me/security/mfa/reverify/start", {}, parseMfaChallenge, signal),

    removeMfaMethod: (methodId, password) =>
      sendVoid("POST", route`/api/me/security/mfa/${methodId}/remove`, withPassword(password)),

    regenerateRecoveryCodes: (password, signal) =>
      sendJson(
        "POST",
        "/api/me/security/recovery/regenerate",
        withPassword(password),
        parseRecoveryCodes,
        signal,
      ),

    // A device that is already gone is as untrusted as it can be.
    revokeTrustedDevice: (deviceId) => deleteResource(route`/api/me/security/trusted/${deviceId}`),
  };
}
