import { describe, expect, it } from "vitest";

import * as camera from "@/lib/voice/camera";
import * as screenShare from "@/lib/voice/screenShare";
import * as settings from "@/lib/voice/settings";

import * as ports from "./index";

describe("ports", () => {
  it("serves the voice vocabulary components print, from the voice library", () => {
    expect(ports.OPUS_PROFILE_LABEL).toBe(settings.OPUS_PROFILE_LABEL);
    expect(ports.OPUS_PROFILE_HINT).toBe(settings.OPUS_PROFILE_HINT);
    expect(ports.NOISE_MODE_LABEL).toBe(settings.NOISE_MODE_LABEL);
    expect(ports.NOISE_MODE_HINT).toBe(settings.NOISE_MODE_HINT);
    expect(ports.PLAYBACK_TUNING_PRESETS).toBe(settings.PLAYBACK_TUNING_PRESETS);
    expect(ports.INPUT_GAIN_MIN_DB).toBe(settings.INPUT_GAIN_MIN_DB);
    expect(ports.INPUT_GAIN_MAX_DB).toBe(settings.INPUT_GAIN_MAX_DB);
    expect(ports.INPUT_GAIN_STEP_DB).toBe(settings.INPUT_GAIN_STEP_DB);
    expect(ports.PLAYBACK_EQ_MIN_DB).toBe(settings.PLAYBACK_EQ_MIN_DB);
    expect(ports.PLAYBACK_EQ_MAX_DB).toBe(settings.PLAYBACK_EQ_MAX_DB);
    expect(ports.PLAYBACK_EQ_STEP_DB).toBe(settings.PLAYBACK_EQ_STEP_DB);
    expect(ports.CAMERA_PROFILES).toBe(camera.CAMERA_PROFILES);
    expect(ports.SCREEN_SHARE_PROFILES).toBe(screenShare.SCREEN_SHARE_PROFILES);
    expect(ports.SCREEN_SHARE_QUALITY_LABEL).toBe(
      screenShare.SCREEN_SHARE_QUALITY_LABEL,
    );
    expect(ports.SCREEN_SHARE_QUALITY_HINT).toBe(
      screenShare.SCREEN_SHARE_QUALITY_HINT,
    );
  });

  it("serves the presence and permission tables the wire types define", () => {
    expect(ports.PRESENCE_VALUES).toEqual(["online", "idle", "dnd", "offline"]);
    for (const presence of ports.PRESENCE_VALUES) {
      expect(ports.PRESENCE_LABEL[presence]).not.toBe("");
      expect(ports.SELF_PRESENCE_LABEL[presence]).not.toBe("");
    }
    expect(ports.SERVER_PERMISSION_VALUES.length).toBeGreaterThan(0);
  });

  it("limits avatars to 4 MB and banners to 8 MB", () => {
    expect(ports.IMAGE_LIMITS.avatar.maxBytes).toBe(4 * 1024 * 1024);
    expect(ports.IMAGE_LIMITS.banner.maxBytes).toBe(8 * 1024 * 1024);
  });

  it("tells a capture failure apart from other errors by its name and message", () => {
    const error = new ports.VoiceMessageCaptureError("Brak dostępu do mikrofonu");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("VoiceMessageCaptureError");
    expect(error.message).toBe("Brak dostępu do mikrofonu");
  });
});
