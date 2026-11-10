import type { AdminApiClient, ApiClient } from "../client";
import {
  parseCustomEmoji,
  parseSoundboardSettings,
  parseSoundboardSnapshot,
  parseSoundboardSound,
} from "../parsers";
import {
  deleteResource,
  fileForm,
  getJson,
  parseList,
  postForm,
  route,
  sendJson,
} from "./http";

type LibraryCalls = Pick<AdminApiClient, "listEmoji" | "uploadEmoji" | "deleteEmoji"> &
  Pick<
    ApiClient,
    | "getSoundboard"
    | "createSoundboardSound"
    | "updateSoundboardSound"
    | "deleteSoundboardSound"
    | "updateSoundboardSettings"
  >;

const parseEmojiList = parseList(parseCustomEmoji);

/** The server's shared media: custom emoji and the soundboard. */
export function libraryCalls(): LibraryCalls {
  return {
    listEmoji: (signal) => getJson("/api/emoji", parseEmojiList, signal),

    uploadEmoji: (shortcode, file, signal) =>
      postForm("/api/emoji", fileForm(file, { shortcode }), parseCustomEmoji, signal),

    deleteEmoji: (emojiId, signal) => deleteResource(route`/api/emoji/${emojiId}`, signal),

    getSoundboard: (signal) => getJson("/api/soundboard", parseSoundboardSnapshot, signal),

    createSoundboardSound: (input, signal) =>
      sendJson("POST", "/api/admin/soundboard/sounds", input, parseSoundboardSound, signal),

    updateSoundboardSound: (soundId, patch, signal) =>
      sendJson(
        "PATCH",
        route`/api/admin/soundboard/sounds/${soundId}`,
        patch,
        parseSoundboardSound,
        signal,
      ),

    deleteSoundboardSound: (soundId, signal) =>
      deleteResource(route`/api/admin/soundboard/sounds/${soundId}`, signal),

    updateSoundboardSettings: (patch, signal) =>
      sendJson(
        "PATCH",
        "/api/admin/soundboard/settings",
        patch,
        parseSoundboardSettings,
        signal,
      ),
  };
}
