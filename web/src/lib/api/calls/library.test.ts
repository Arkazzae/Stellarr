import { describe, expect, it } from "vitest";

import {
  itAnswersMissingDeletes,
  itSendsCalls,
  jsonResponse,
  mockFetch,
  sentRequest,
} from "@/test/http";

import { libraryCalls } from "./library";

const fetchMock = mockFetch();
const calls = libraryCalls();

const SOUND = {
  id: "snd-1",
  name: "Gong",
  glyph: "G",
  url: "/assets/snd-1",
  durationSeconds: 2,
  trimStartSeconds: 0,
  trimEndSeconds: 2,
};
const SETTINGS = { everyoneCanPlay: true, rateLimited: false };

describe("library calls", () => {
  itSendsCalls(fetchMock, [
    {
      name: "listEmoji",
      run: () => calls.listEmoji(),
      method: "GET",
      url: "/api/emoji",
      answer: [{ id: "e-1", shortcode: ":pepe:", glyph: "/api/emoji/e-1/image" }],
    },
    { name: "deleteEmoji", run: () => calls.deleteEmoji("e/1"), method: "DELETE", url: "/api/emoji/e%2F1" },
    {
      name: "getSoundboard",
      run: () => calls.getSoundboard(),
      method: "GET",
      url: "/api/soundboard",
      answer: { sounds: [SOUND], settings: SETTINGS, canManage: true },
    },
    {
      name: "createSoundboardSound",
      run: () =>
        calls.createSoundboardSound({
          attachmentId: "a-1",
          name: "Gong",
          glyph: "G",
          trimStartSeconds: 0,
          trimEndSeconds: 2,
        }),
      method: "POST",
      url: "/api/admin/soundboard/sounds",
      body: { attachmentId: "a-1", name: "Gong", glyph: "G", trimStartSeconds: 0, trimEndSeconds: 2 },
      answer: SOUND,
    },
    {
      name: "updateSoundboardSound",
      run: () => calls.updateSoundboardSound("snd-1", { name: "Dzwon" }),
      method: "PATCH",
      url: "/api/admin/soundboard/sounds/snd-1",
      body: { name: "Dzwon" },
      answer: SOUND,
    },
    {
      name: "deleteSoundboardSound",
      run: () => calls.deleteSoundboardSound("snd-1"),
      method: "DELETE",
      url: "/api/admin/soundboard/sounds/snd-1",
    },
    {
      name: "updateSoundboardSettings",
      run: () => calls.updateSoundboardSettings({ rateLimited: true }),
      method: "PATCH",
      url: "/api/admin/soundboard/settings",
      body: { rateLimited: true },
      answer: SETTINGS,
    },
  ]);

  itAnswersMissingDeletes(
    fetchMock,
    {
      deleteEmoji: () => calls.deleteEmoji("e-1"),
      deleteSoundboardSound: () => calls.deleteSoundboardSound("snd-1"),
    },
    true,
  );

  it("uploads an emoji with its shortcode ahead of the file", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "e-2", shortcode: ":pepe:", glyph: "/api/emoji/e-2/image" }, 201),
    );

    await expect(
      calls.uploadEmoji("pepe", new File(["png"], "pepe.png", { type: "image/png" })),
    ).resolves.toMatchObject({ id: "e-2" });

    const sent = sentRequest(fetchMock);
    const form = sent.body as FormData;
    expect([sent.method, sent.url]).toEqual(["POST", "/api/emoji"]);
    expect([...form.keys()]).toEqual(["shortcode", "file"]);
    expect(form.get("shortcode")).toBe("pepe");
    expect(form.get("file")).toMatchObject({ name: "pepe.png" });
  });
});
