import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeQr } from "./qr";

const URI =
  "otpauth://totp/Stellarr%3Amaja?secret=JBSWY3DPEHPK3PXP&issuer=Stellarr&algorithm=SHA1&digits=6&period=30";

const fingerprint = (dark: boolean[][]) =>
  createHash("sha256")
    .update(dark.map((row) => row.map((module) => (module ? "1" : "0")).join("")).join("\n"))
    .digest("hex")
    .slice(0, 16);

describe("encodeQr", () => {
  // These two matrices were read back by a real QR decoder (Chrome's
  // BarcodeDetector) when the encoder was written. A change to either
  // fingerprint means the output changed and has to be decoded again.
  it.each([
    ["Hello", 21, "23ee6cfca3dbe1d4"],
    [URI, 41, "8c364602b3f46fb2"],
  ])("draws %s as the matrix a decoder has read", (text, size, expected) => {
    const qr = encodeQr(text);

    expect(qr.size).toBe(size);
    expect(fingerprint(qr.dark)).toBe(expected);
  });

  it("places the three finder patterns and the dark module", () => {
    const { size, dark } = encodeQr(URI);
    const ring = (x0: number, y0: number) =>
      [0, 1, 2, 3, 4, 5, 6].every((i) => dark[y0]![x0 + i] && dark[y0 + 6]![x0 + i]);

    expect(ring(0, 0)).toBe(true);
    expect(ring(size - 7, 0)).toBe(true);
    expect(ring(0, size - 7)).toBe(true);
    expect(dark[size - 8]![8]).toBe(true);
  });

  it("refuses text that no version can hold", () => {
    expect(() => encodeQr("x".repeat(3000))).toThrow(RangeError);
  });
});
