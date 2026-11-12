import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PasskeyCancelledError,
  creationOptions,
  encodeCredential,
  fromBase64Url,
  getPasskey,
  passkeysSupported,
  requestOptions,
  toBase64Url,
} from "./webauthn";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const read = (buffer: unknown) => Array.from(new Uint8Array(buffer as ArrayBuffer));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base64url", () => {
  it("round-trips bytes that plain base64 would write with + and /", () => {
    const value = bytes(0xfb, 0xff, 0xbf, 0x00, 0x01);

    const text = toBase64Url(value);

    expect(text).toBe("-_-_AAE");
    expect(read(fromBase64Url(text))).toEqual(read(value));
  });
});

describe("options from the server", () => {
  it("turns the binary fields of creation options into bytes and drops nulls", () => {
    const options = creationOptions({
      rp: { id: "chat.example", name: "Stellarr" },
      user: { id: "AQID", name: "maja", displayName: "Maja" },
      challenge: "BAUG",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: null, residentKey: "preferred", userVerification: "required" },
      excludeCredentials: [{ type: "public-key", id: "Bwg", transports: ["usb"] }],
    });

    expect(read(options.challenge)).toEqual([4, 5, 6]);
    expect(read(options.user.id)).toEqual([1, 2, 3]);
    expect(read(options.excludeCredentials?.[0]?.id)).toEqual([7, 8]);
    expect(options.authenticatorSelection).toEqual({ residentKey: "preferred", userVerification: "required" });
  });

  it("turns the binary fields of request options into bytes", () => {
    const options = requestOptions({
      challenge: "BAUG",
      rpId: "chat.example",
      allowCredentials: [{ type: "public-key", id: "Bwg" }],
      userVerification: "required",
    });

    expect(read(options.challenge)).toEqual([4, 5, 6]);
    expect(read(options.allowCredentials?.[0]?.id)).toEqual([7, 8]);
    expect(options.rpId).toBe("chat.example");
  });

  it("refuses options without a challenge rather than asking the browser with none", () => {
    expect(() => requestOptions({ rpId: "chat.example" })).toThrow(TypeError);
  });
});

describe("answers to the server", () => {
  it("writes a new credential with its transports, keeping only ones the server knows", () => {
    const encoded = encodeCredential({
      id: "Bwg",
      rawId: bytes(7, 8),
      type: "public-key",
      getClientExtensionResults: () => ({}),
      response: {
        attestationObject: bytes(1),
        clientDataJSON: bytes(2),
        getTransports: () => ["internal", "hybrid", "something-new"],
      },
    } as unknown as PublicKeyCredential);

    expect(encoded).toEqual({
      id: "Bwg",
      rawId: "Bwg",
      type: "public-key",
      clientExtensionResults: {},
      response: { attestationObject: "AQ", clientDataJSON: "Ag", transports: ["internal", "hybrid"] },
    });
  });

  it("writes an assertion with its user handle, or null when the key gives none", () => {
    const assertion = (userHandle: ArrayBuffer | null) =>
      encodeCredential({
        id: "Bwg",
        rawId: bytes(7, 8),
        type: "public-key",
        getClientExtensionResults: () => ({}),
        response: { authenticatorData: bytes(1), clientDataJSON: bytes(2), signature: bytes(3), userHandle },
      } as unknown as PublicKeyCredential);

    expect(assertion(bytes(9)).response).toEqual({
      authenticatorData: "AQ",
      clientDataJSON: "Ag",
      signature: "Aw",
      userHandle: "CQ",
    });
    expect((assertion(null).response as { userHandle: unknown }).userHandle).toBeNull();
  });
});

describe("the browser prompt", () => {
  it("reports a closed or timed-out prompt as cancelled, not as a failure", async () => {
    vi.stubGlobal("navigator", {
      credentials: { get: vi.fn(async () => Promise.reject(new DOMException("closed", "NotAllowedError"))) },
    });

    await expect(getPasskey({ challenge: "BAUG" })).rejects.toBeInstanceOf(PasskeyCancelledError);
  });

  it("passes on any other failure as it came", async () => {
    const failure = new DOMException("bad rp", "SecurityError");
    vi.stubGlobal("navigator", { credentials: { get: vi.fn(async () => Promise.reject(failure)) } });

    await expect(getPasskey({ challenge: "BAUG" })).rejects.toBe(failure);
  });

  it("knows a browser without WebAuthn has no passkeys", () => {
    expect(passkeysSupported()).toBe(false);
  });
});
