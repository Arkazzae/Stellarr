import { describe, expect, it, vi } from "vitest";
import { CameraCaptureError, captureCamera } from "./camera";

const settings = { videoDeviceId: null, cameraQuality: "balanced" } as const;

function failWith(name: string) {
  return vi.fn(async () => {
    throw new DOMException("refused", name);
  });
}

describe("captureCamera failures", () => {
  it("treats a missing or busy device as unavailable", async () => {
    for (const name of [
      "NotFoundError",
      "OverconstrainedError",
      "NotReadableError",
      "AbortError",
    ]) {
      await expect(captureCamera(settings, failWith(name))).rejects.toMatchObject({
        kind: "unavailable",
      });
    }
  });

  it("treats a blocked page as denied", async () => {
    await expect(captureCamera(settings, failWith("SecurityError"))).rejects.toMatchObject({
      kind: "denied",
    });
  });

  it("reports a browser that cannot open cameras as unsupported", async () => {
    await expect(captureCamera(settings, failWith("NotSupportedError"))).rejects.toMatchObject({
      kind: "unsupported",
    });
    await expect(captureCamera(settings, null)).rejects.toMatchObject({
      kind: "unsupported",
    });
  });

  it("falls back to a generic failure for anything unrecognised", async () => {
    const failure = await captureCamera(settings, async () => {
      throw new Error("weird");
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CameraCaptureError);
    expect(failure).toMatchObject({ kind: "unavailable" });
  });

  it("always carries a message a person can read", async () => {
    for (const name of ["NotAllowedError", "NotFoundError", "NotSupportedError", "Other"]) {
      const failure = (await captureCamera(settings, failWith(name)).catch(
        (error: unknown) => error,
      )) as CameraCaptureError;
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });
});
