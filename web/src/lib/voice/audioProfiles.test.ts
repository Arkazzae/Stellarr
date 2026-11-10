import { describe, expect, it } from "vitest";
import {
  AUDIO_PROFILES,
  microphoneConstraints,
  opusParameters,
  profileFor,
  usesWorkletSuppression,
} from "./audioProfiles";
import { DEFAULT_SETTINGS } from "./settings";

describe("AUDIO_PROFILES", () => {
  it("keeps every adaptive range ordered and every ceiling above the profile before it", () => {
    const speech = ["economy", "balanced", "clarity", "premium", "studio"] as const;
    let previousCeiling = 0;
    for (const id of speech) {
      const profile = AUDIO_PROFILES[id];
      expect(profile.minBitrate).toBeLessThan(profile.maxBitrate);
      expect(profile.maxBitrate).toBeGreaterThan(previousCeiling);
      previousCeiling = profile.maxBitrate;
    }
  });

  it("uses DTX only for the bandwidth-saving profile", () => {
    const withDtx = Object.values(AUDIO_PROFILES).filter((profile) => profile.dtx);
    expect(withDtx.map((profile) => profile.id)).toEqual(["economy"]);
  });

  it("is mono speech everywhere except shared-screen music", () => {
    for (const profile of Object.values(AUDIO_PROFILES)) {
      expect(profile.stereo).toBe(profile.id === "music");
      expect(profile.contentHint).toBe(profile.id === "music" ? "music" : "speech");
    }
  });
});

describe("profileFor", () => {
  it("resolves the profile named by the settings", () => {
    expect(profileFor({ ...DEFAULT_SETTINGS, opusProfile: "studio" })).toBe(
      AUDIO_PROFILES.studio,
    );
    expect(profileFor(DEFAULT_SETTINGS)).toBe(AUDIO_PROFILES.premium);
  });
});

describe("opusParameters", () => {
  it("asks for FEC, 20 ms packets and the profile's bitrate ceiling", () => {
    expect(opusParameters(AUDIO_PROFILES.premium)).toEqual({
      useinbandfec: "1",
      usedtx: "0",
      maxaveragebitrate: "128000",
      stereo: "0",
      "sprop-stereo": "0",
      minptime: "10",
    });
  });

  it("switches DTX on for the economy profile", () => {
    expect(opusParameters(AUDIO_PROFILES.economy)).toMatchObject({
      usedtx: "1",
      maxaveragebitrate: "32000",
    });
  });

  it("offers stereo for music and falls back to mono when the peer cannot take it", () => {
    expect(opusParameters(AUDIO_PROFILES.music)).toMatchObject({
      stereo: "1",
      "sprop-stereo": "1",
    });
    expect(opusParameters(AUDIO_PROFILES.music, false)).toMatchObject({
      stereo: "0",
      "sprop-stereo": "0",
    });
  });

  it("never turns a mono profile into stereo", () => {
    expect(opusParameters(AUDIO_PROFILES.studio, true)).toMatchObject({ stereo: "0" });
  });
});

describe("microphoneConstraints", () => {
  it("leaves noise suppression to the browser only when it is the chosen engine", () => {
    for (const mode of ["rnnoise", "gtcrn", "speex", "off"] as const) {
      expect(
        microphoneConstraints({ ...DEFAULT_SETTINGS, noiseSuppression: mode }),
      ).toMatchObject({ noiseSuppression: false });
    }
    expect(
      microphoneConstraints({ ...DEFAULT_SETTINGS, noiseSuppression: "browser" }),
    ).toMatchObject({ noiseSuppression: true });
  });

  it("never lets the browser level the volume, whatever the setting", () => {
    for (const autoGainControl of [true, false]) {
      expect(
        microphoneConstraints({ ...DEFAULT_SETTINGS, autoGainControl }).autoGainControl,
      ).toBe(false);
    }
  });

  it("keeps echo cancellation under the person's control", () => {
    expect(
      microphoneConstraints({ ...DEFAULT_SETTINGS, echoCancellation: false })
        .echoCancellation,
    ).toBe(false);
  });

  it("pins the chosen device and otherwise takes the system default", () => {
    expect(
      microphoneConstraints({ ...DEFAULT_SETTINGS, inputDeviceId: "mic-7" }).deviceId,
    ).toEqual({ exact: "mic-7" });
    expect(microphoneConstraints(DEFAULT_SETTINGS)).not.toHaveProperty("deviceId");
  });
});

describe("usesWorkletSuppression", () => {
  it("is true for the three local engines only", () => {
    expect(["rnnoise", "gtcrn", "speex"].every(usesWorkletSuppression)).toBe(true);
    expect(["browser", "off", "", "magic"].some(usesWorkletSuppression)).toBe(false);
  });
});
