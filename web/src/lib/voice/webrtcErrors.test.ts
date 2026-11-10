import { describe, expect, it } from "vitest";

import { CameraCaptureError } from "./camera";
import { IceConfigError } from "./iceSession";
import { MicCaptureError } from "./micPipeline";
import { ScreenShareError } from "./screenShare";
import {
  cameraError,
  degradedNotice,
  iceConfigError,
  micError,
  peerLostError,
  peerStalledError,
  rtcIncompatibility,
  screenShareError,
} from "./webrtcErrors";

describe("rtcIncompatibility", () => {
  it("accepts the mesh topology at the protocol version this client speaks", () => {
    expect(rtcIncompatibility({ protocolVersion: 1, topology: "mesh" })).toBeNull();
  });

  it("names the version the server announced", () => {
    expect(rtcIncompatibility({ protocolVersion: 2, topology: "mesh" })).toContain("(2)");
  });

  it("refuses a topology it cannot join, naming it", () => {
    expect(rtcIncompatibility({ protocolVersion: 1, topology: "sfu" })).toContain("sfu");
  });

  it("checks the version before the topology", () => {
    expect(rtcIncompatibility({ protocolVersion: 0, topology: "unknown" })).toContain(
      "wersji RTC",
    );
  });
});

describe("micError", () => {
  it.each([
    ["denied", "mic-denied"],
    ["unsupported", "unsupported"],
    ["unavailable", "mic-unavailable"],
  ] as const)("maps a %s capture failure to %s", (failure, kind) => {
    expect(micError(new MicCaptureError(failure, "komunikat"))).toEqual({
      kind,
      message: "komunikat",
    });
  });

  it("treats anything else as a missing microphone", () => {
    expect(micError(new TypeError("boom"))).toMatchObject({ kind: "mic-unavailable" });
  });
});

describe("cameraError", () => {
  it("passes on what the capture said, and keeps the call usable", () => {
    expect(cameraError(new CameraCaptureError("denied", "Zablokowana."))).toEqual({
      kind: "camera",
      message: "Zablokowana.",
      recoverable: true,
    });
  });

  it("falls back to a general sentence for anything else", () => {
    expect(cameraError(new TypeError("boom"))).toMatchObject({
      kind: "camera",
      recoverable: true,
      message: expect.stringContaining("kamery"),
    });
  });
});

describe("screenShareError", () => {
  it("is silent when the picker was cancelled", () => {
    expect(screenShareError(new ScreenShareError("cancelled", "Anulowane."))).toBeNull();
  });

  it.each(["denied", "unsupported", "unavailable"] as const)(
    "reports a %s share without ending the call",
    (kind) => {
      expect(screenShareError(new ScreenShareError(kind, "Nie wyszło."))).toEqual({
        kind: "screen-share",
        message: "Nie wyszło.",
        recoverable: true,
      });
    },
  );

  it("falls back to a general sentence for anything else", () => {
    expect(screenShareError(new TypeError("boom"))).toMatchObject({
      kind: "screen-share",
      recoverable: true,
      message: "Nie udało się udostępnić ekranu.",
    });
  });
});

describe("iceConfigError", () => {
  it("tells expired credentials apart from an unreachable server", () => {
    const expired = iceConfigError(new IceConfigError("expired", "x"));
    const unreachable = iceConfigError(new IceConfigError("unavailable", "x"));

    expect(expired.kind).toBe("ice-config");
    expect(expired.message).toContain("wygasła");
    expect(unreachable.message).toContain("pobrać");
  });

  it("falls back to the unreachable wording for an unknown failure", () => {
    expect(iceConfigError(new Error("network")).message).toContain("pobrać");
  });
});

describe("peer transport errors", () => {
  it("name the person and stay recoverable", () => {
    expect(peerStalledError("Ola")).toMatchObject({
      kind: "transport",
      recoverable: true,
      message: expect.stringContaining("Ola"),
    });
    expect(peerLostError("Ola")).toMatchObject({
      kind: "transport",
      recoverable: true,
      message: expect.stringContaining("Ola"),
    });
  });
});

describe("degradedNotice", () => {
  it("says nothing when what runs is what was asked for", () => {
    expect(degradedNotice("rnnoise", "rnnoise")).toBeNull();
    expect(degradedNotice("browser", "browser")).toBeNull();
  });

  it("treats a suppressor that was switched off as a choice, not a degradation", () => {
    expect(degradedNotice("off", "none")).toBeNull();
  });

  it("says the browser took over when a worklet suppressor failed", () => {
    expect(degradedNotice("gtcrn", "browser")).toBe(
      "Nie udało się uruchomić GTCRN. Działa redukcja szumu przeglądarki.",
    );
  });

  it("names the suppressor that replaced the requested one", () => {
    expect(degradedNotice("gtcrn", "rnnoise")).toBe(
      "Nie udało się uruchomić GTCRN. Działa RNNoise.",
    );
  });

  it("admits the audio is raw when nothing could be started", () => {
    expect(degradedNotice("speex", "none")).toContain("nieprzetworzony");
  });

  it("reports an input gate that is not in the signal path", () => {
    expect(
      degradedNotice("off", "none", { requested: true, active: false }),
    ).toContain("Bramka mikrofonu");
    expect(degradedNotice("off", "none", { requested: true, active: true })).toBeNull();
  });

  it("distinguishes the browser's leveller from no leveller at all", () => {
    const browser = degradedNotice("off", "none", undefined, {
      requested: true,
      active: "browser",
    });
    const none = degradedNotice("off", "none", undefined, {
      requested: true,
      active: "none",
    });

    expect(browser).toContain("w wersji przeglądarki");
    expect(none).toBe("Automatyczna głośność nie działa w tej przeglądarce.");
    expect(
      degradedNotice("off", "none", undefined, { requested: true, active: "worklet" }),
    ).toBeNull();
  });

  it("reports every mismatch at once", () => {
    const notice = degradedNotice(
      "rnnoise",
      "browser",
      { requested: true, active: false },
      { requested: true, active: "none" },
    );

    expect(notice).toContain("RNNoise");
    expect(notice).toContain("Bramka mikrofonu");
    expect(notice).toContain("Automatyczna głośność nie działa");
  });
});
