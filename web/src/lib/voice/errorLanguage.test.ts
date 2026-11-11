import { afterEach, describe, expect, it } from "vitest";

import type { Translator } from "@/i18n";
import type { RealtimeClient } from "@/lib/realtime/types";
import { english, polish } from "@/test/translators";

import { captureCamera } from "./camera";
import { IceConfigError, type VoiceIceProvider } from "./iceSession";
import { openMicrophone } from "./micAcquire";
import { captureScreen, classifyScreenError } from "./screenShare";
import { WebRtcVoiceClient, type WebRtcVoiceClientOptions } from "./webrtc";
import {
  cameraError,
  degradedNotice,
  iceConfigError,
  joinFailedError,
  micError,
  rtcIncompatibility,
} from "./webrtcErrors";

afterEach(() => {
  document.documentElement.lang = "pl";
});

/** A client that refuses to join, which needs nothing from the network. */
function incompatibleClient(translate?: Translator): WebRtcVoiceClient {
  const options: WebRtcVoiceClientOptions = {
    realtime: {} as RealtimeClient,
    selfUserId: "u-a",
    selfDisplayName: "Ada",
    ice: {} as VoiceIceProvider,
    rtc: { protocolVersion: 0 },
    ...(translate === undefined ? {} : { translate }),
  };
  return new WebRtcVoiceClient(options);
}

describe("what the voice client tells a person", () => {
  it("is worded by the translator it is given", () => {
    expect(joinFailedError(polish).message).toBe(
      "Nie udało się dołączyć do rozmowy głosowej. Spróbuj ponownie.",
    );
    expect(joinFailedError(english).message).toBe("Could not join the voice call. Try again.");
  });

  it("follows a switch of language made while the client lives, when its translator does", () => {
    let current: Translator = polish;
    const live: Translator = (key, values) => current(key, values);

    const before = micError(live, new TypeError("boom")).message;
    current = english;
    const after = micError(live, new TypeError("boom")).message;

    expect(before).toBe("Brak dostępnego mikrofonu. Podłącz go i dołącz ponownie.");
    expect(after).toBe("No microphone is available. Plug one in and join again.");
  });

  it("fills the names and versions in for the reader's language", () => {
    expect(rtcIncompatibility(english, { protocolVersion: 7 })).toBe(
      "The server uses an unsupported RTC version (7); this client supports v1.",
    );
    expect(iceConfigError(english, new IceConfigError("expired", "x")).message).toContain(
      "expired",
    );
  });

  it("explains a degraded microphone in the reader's language", () => {
    expect(degradedNotice(english, "gtcrn", "browser")).toBe(
      "Could not start GTCRN. The browser's noise suppression is running instead.",
    );
    expect(degradedNotice(english, "speex", "none")).toContain("unprocessed");
  });

  it("describes a camera that cannot open", async () => {
    const settings = { videoDeviceId: null, cameraQuality: "balanced" } as const;

    await expect(captureCamera(settings, null, english)).rejects.toThrow(
      "This browser does not support the camera in calls.",
    );
    await expect(captureCamera(settings, null, polish)).rejects.toThrow(
      "Ta przeglądarka nie obsługuje kamery w rozmowie.",
    );
    expect(cameraError(polish, new TypeError("boom")).message).toContain("kamery");
  });

  it("describes a screen that cannot be shared", async () => {
    await expect(captureScreen(null, undefined, english)).rejects.toThrow(
      "This browser cannot share the screen. An HTTPS connection is required.",
    );
    expect(classifyScreenError(new DOMException("", "NotFoundError"), english).message).toBe(
      "Could not capture the screen. Try again.",
    );
  });

  it("describes a microphone that is blocked", async () => {
    const blocked = () => Promise.reject(new DOMException("", "NotAllowedError"));

    await expect(
      openMicrophone(
        { inputDeviceId: null, echoCancellation: false } as Parameters<typeof openMicrophone>[0],
        blocked,
        english,
      ),
    ).rejects.toThrow(
      "Microphone access was blocked. Allow it in your browser settings and join again.",
    );
  });
});

describe("a voice client", () => {
  it("words its failures through the translator it was given, whatever the page says", async () => {
    document.documentElement.lang = "pl";
    const client = incompatibleClient(english);

    await client.join("channel");

    expect(client.getSnapshot().error?.message).toContain("unsupported RTC version");
  });

  it("asks the translator again for each failure, so a switch of language reaches it", async () => {
    let current: Translator = polish;
    const client = incompatibleClient((key, values) => current(key, values));

    await client.join("channel");
    const before = client.getSnapshot().error?.message;
    current = english;
    await client.join("channel");

    expect(before).toContain("wersji RTC");
    expect(client.getSnapshot().error?.message).toContain("unsupported RTC version");
  });

  it("follows the page's language when it was given no translator", async () => {
    document.documentElement.lang = "en";
    const client = incompatibleClient();

    await client.join("channel");

    expect(client.getSnapshot().error?.message).toContain("unsupported RTC version");
  });
});
