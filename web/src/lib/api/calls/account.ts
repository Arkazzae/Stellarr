import type { ApiClient } from "../client";
import {
  parseAccount,
  parseJoinSoundLibrary,
  parsePasswordAnswer,
  parsePreferences,
} from "../parsers";
import { fileForm, getJson, postForm, route, sendJson } from "./http";

type AccountCalls = Pick<
  ApiClient,
  | "getAccount"
  | "updateAccount"
  | "updatePreferences"
  | "getJoinSoundLibrary"
  | "changePassword"
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

    changePassword: (currentPassword, newPassword, signal) =>
      sendJson(
        "POST",
        "/api/me/password",
        { currentPassword, newPassword },
        parsePasswordAnswer,
        signal,
      ),

    uploadAccountImage: (kind, file, signal) =>
      postForm(route`/api/me/images/${kind}`, fileForm(file), parseAccount, signal),

    removeAccountImage: (kind, signal) =>
      sendJson("DELETE", route`/api/me/images/${kind}`, undefined, parseAccount, signal),
  };
}
