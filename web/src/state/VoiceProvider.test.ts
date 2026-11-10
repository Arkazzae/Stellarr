import { describe, expect, it } from "vitest";

import { voiceErrorForUi, voiceProblemForUi } from "./VoiceProvider";

describe("voiceErrorForUi", () => {
  it.each(["ice-config", "signaling", "transport"] as const)(
    "keeps %s failures visible and actionable",
    (kind) => {
      expect(voiceErrorForUi({ kind, message: "low-level failure" })).not.toBeNull();
    },
  );

  it("keeps an actionable microphone error visible", () => {
    expect(
      voiceErrorForUi({ kind: "mic-denied", message: "NotAllowedError" }),
    ).toMatch(/mikrofon/i);
  });

  it("keeps the camera recovery instruction from the media layer", () => {
    expect(
      voiceErrorForUi({
        kind: "camera",
        message: "Zezwól na kamerę w ustawieniach przeglądarki.",
        recoverable: true,
      }),
    ).toBe("Zezwól na kamerę w ustawieniach przeglądarki.");
  });

  it("shapes camera failures into a named, recoverable room problem", () => {
    expect(
      voiceProblemForUi({
        kind: "camera",
        message: "Kamera jest używana przez inną aplikację.",
        recoverable: true,
      }),
    ).toEqual({
      kind: "camera",
      title: "Kamera nie działa",
      message: "Kamera jest używana przez inną aplikację.",
      recoverable: true,
    });
  });

  it("keeps the affected person in a recoverable audio failure", () => {
    expect(
      voiceProblemForUi({
        kind: "transport",
        message: "Utracono połączenie audio z: Ada.",
        recoverable: true,
      }),
    ).toMatchObject({
      title: "Problem z dźwiękiem rozmowy",
      message: "Utracono połączenie audio z: Ada.",
    });
  });
});
