/**
 * The browser half of a passkey ceremony. The server sends its options as
 * JSON with binary fields in base64url; the browser wants those as bytes,
 * and answers with bytes the server wants back as base64url. Nothing here
 * checks a signature: the server does, against the options it kept.
 */

/** The answer to `navigator.credentials.create` or `.get`, ready to send as JSON. */
export type PasskeyResponse = Record<string, unknown>;

/** The browser said no: the prompt was closed, timed out, or no passkey was picked. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super("passkey-cancelled");
    this.name = "PasskeyCancelledError";
  }
}

/** Transports the server knows; a newer hint from the browser is dropped rather than refused. */
const TRANSPORTS = new Set(["usb", "nfc", "ble", "smart-card", "hybrid", "internal"]);

export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A copy without null members: the browser reads a null enum as a wrong value. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, member]) => member !== null)
      .map(([key, member]) => [key, withoutNulls(member)]),
  );
}

function binaryString(record: Json, key: string): ArrayBuffer {
  const value = record[key];
  if (typeof value !== "string") throw new TypeError(`passkey options: ${key} is missing`);
  return fromBase64Url(value);
}

const descriptors = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(isObject).map((descriptor) => ({ ...descriptor, id: binaryString(descriptor, "id") }))
    : [];

export function creationOptions(json: unknown): PublicKeyCredentialCreationOptions {
  const options = withoutNulls(json);
  if (!isObject(options) || !isObject(options.user)) throw new TypeError("passkey options: not creation options");
  return {
    ...options,
    challenge: binaryString(options, "challenge"),
    user: { ...options.user, id: binaryString(options.user, "id") },
    excludeCredentials: descriptors(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
}

export function requestOptions(json: unknown): PublicKeyCredentialRequestOptions {
  const options = withoutNulls(json);
  if (!isObject(options)) throw new TypeError("passkey options: not request options");
  return {
    ...options,
    challenge: binaryString(options, "challenge"),
    allowCredentials: descriptors(options.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;
}

export function encodeCredential(credential: PublicKeyCredential): PasskeyResponse {
  const response = credential.response;
  const common = {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  if ("attestationObject" in response) {
    const attestation = response as AuthenticatorAttestationResponse;
    return {
      ...common,
      response: {
        attestationObject: toBase64Url(attestation.attestationObject),
        clientDataJSON: toBase64Url(attestation.clientDataJSON),
        transports: (attestation.getTransports?.() ?? []).filter((transport) => TRANSPORTS.has(transport)),
      },
    };
  }
  const assertion = response as AuthenticatorAssertionResponse;
  return {
    ...common,
    response: {
      authenticatorData: toBase64Url(assertion.authenticatorData),
      clientDataJSON: toBase64Url(assertion.clientDataJSON),
      signature: toBase64Url(assertion.signature),
      userHandle: assertion.userHandle === null ? null : toBase64Url(assertion.userHandle),
    },
  };
}

/** A prompt the person closed or let run out is not a failure to report as one. */
function cancelled(cause: unknown): boolean {
  return cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "AbortError");
}

export async function createPasskey(options: unknown): Promise<PasskeyResponse> {
  try {
    const credential = await navigator.credentials.create({ publicKey: creationOptions(options) });
    if (!(credential instanceof PublicKeyCredential)) throw new PasskeyCancelledError();
    return encodeCredential(credential);
  } catch (cause) {
    if (cancelled(cause)) throw new PasskeyCancelledError();
    throw cause;
  }
}

export async function getPasskey(options: unknown): Promise<PasskeyResponse> {
  try {
    const credential = await navigator.credentials.get({ publicKey: requestOptions(options) });
    if (!(credential instanceof PublicKeyCredential)) throw new PasskeyCancelledError();
    return encodeCredential(credential);
  } catch (cause) {
    if (cancelled(cause)) throw new PasskeyCancelledError();
    throw cause;
  }
}
