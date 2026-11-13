import type { ApiClient } from "../client";
import {
  parseAccount,
  parseClientSettings,
  parseEmailChangeAnswer,
  parseJoinSoundLibrary,
  parsePasswordAnswer,
  parsePreferences,
} from "../parsers";
import { fileForm, getJson, postForm, route, sendJson, sendVoid } from "./http";

type AccountCalls = Pick<
  ApiClient,
  | "getAccount"
  | "updateAccount"
  | "updatePreferences"
  | "getJoinSoundLibrary"
  | "getClientSettings"
  | "saveClientSettings"
  | "changePassword"
  | "requestEmailChange"
  | "uploadAccountImage"
  | "removeAccountImage"
>;

export function accountCalls(): AccountCalls {
  return {
    getAccount: (signal) => getJson("/api/me", parseAccount, signal),

    updateAccount: (input, signal) => sendJson("PATCH", "/api/me", input, parseAccount, signal),

    updatePreferences: (input, signal) =>
      sendJson("PATCH", "/api/me/preferences", input, parsePreferences, signal),

    getJoinSoundLibrary: (signal) =>
      getJson("/api/me/join-sound", parseJoinSoundLibrary, signal),

    getClientSettings: (signal) => getJson("/api/me/settings", parseClientSettings, signal),

    saveClientSettings: (section, value, signal) =>
      sendVoid("PUT", route`/api/me/settings/${section}`, value, signal),

    changePassword: (currentPassword, newPassword, signal) =>
      sendJson(
        "POST",
        "/api/me/password",
        { currentPassword, newPassword },
        parsePasswordAnswer,
        signal,
      ),

    requestEmailChange: (email, password, signal) =>
      sendJson("POST", "/api/me/email", { email, password }, parseEmailChangeAnswer, signal),

    uploadAccountImage: (kind, file, signal) =>
      postForm(route`/api/me/images/${kind}`, fileForm(file), parseAccount, signal),

    removeAccountImage: (kind, signal) =>
      sendJson("DELETE", route`/api/me/images/${kind}`, undefined, parseAccount, signal),
  };
}
