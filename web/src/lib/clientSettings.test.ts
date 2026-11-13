import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/voice/settings";

import { languageFromWire, stableJson, voiceFromWire, voiceToWire } from "./clientSettings";

describe("stableJson", () => {
  it("reads equal settings as equal whatever order their keys came in", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      stableJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });
});

describe("languageFromWire", () => {
  it("takes only what this client can show", () => {
    expect(
      languageFromWire({ locale: "de", chatTranslationEnabled: "yes", chatTranslationTargetLanguage: "pl" }),
    ).toEqual({ chatTranslationTargetLanguage: "pl" });
  });

  it("never brings automatic translation along", () => {
    expect(languageFromWire({ chatAutoTranslateEnabled: true })).toEqual({});
  });
});

describe("voice settings on the account", () => {
  it("keep this computer's devices out in both directions", () => {
    const here = { ...DEFAULT_SETTINGS, inputDeviceId: "mic-here", vadSensitivity: 30 };

    expect(voiceToWire(here)).not.toHaveProperty("inputDeviceId");
    expect(
      voiceFromWire({ ...DEFAULT_SETTINGS, inputDeviceId: "mic-there", inputGainDb: 6 }, here),
    ).toMatchObject({ inputDeviceId: "mic-here", vadSensitivity: 30, inputGainDb: 6 });
  });

  it("clamps what another build wrote instead of trusting it", () => {
    expect(voiceFromWire({ version: DEFAULT_SETTINGS.version, inputGainDb: 900 }, DEFAULT_SETTINGS)).toMatchObject({
      inputGainDb: 24,
    });
  });
});
