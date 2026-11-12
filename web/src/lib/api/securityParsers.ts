import { ApiError } from "./errors";
import {
  expectArray,
  expectBoolean,
  expectRecord,
  expectSafeInteger,
  expectString,
  isRecord,
  optionalString,
} from "./expect";
import { parseUser } from "./parsers";
import type {
  AuthResult,
  MfaChallenge,
  MfaCompletion,
  MfaEnrollment,
  MfaMethod,
  MfaMethodType,
  MfaPurpose,
} from "./types";

const METHOD_TYPES: readonly MfaMethodType[] = ["totp", "email"];
const PURPOSES: readonly MfaPurpose[] = ["mfa", "enrollment", "recovery", "reverify"];

function oneOf<T extends string>(
  values: readonly T[],
  source: Record<string, unknown>,
  key: string,
  path: string,
): T {
  const value = expectString(source, key, path);
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ApiError("malformed", `${path}: "${key}" is not one of ${values.join(", ")}`);
  }
  return match;
}

export function parseMfaMethod(value: unknown, path: string): MfaMethod {
  const record = expectRecord(value, path);
  const lastUsedAt = optionalString(record, "lastUsedAt");
  const emailAddress = optionalString(record, "emailAddress");
  return {
    id: expectString(record, "id", path),
    type: oneOf(METHOD_TYPES, record, "type", path),
    name: expectString(record, "name", path),
    createdAt: expectString(record, "createdAt", path),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
    ...(emailAddress === undefined ? {} : { emailAddress }),
    pending: expectBoolean(record, "pending", path),
  };
}

export function parseMfaChallenge(value: unknown, path: string): MfaChallenge {
  const record = expectRecord(value, path);
  const status = expectString(record, "status", path);
  if (status !== "mfa_required" && status !== "mfa_enrollment_required") {
    throw new ApiError("malformed", `${path}: "${status}" is not a challenge`);
  }
  return {
    enrollment: status === "mfa_enrollment_required",
    challengeId: expectString(record, "challengeId", path),
    purpose: oneOf(PURPOSES, record, "purpose", path),
    expiresAt: expectString(record, "expiresAt", path),
    methods: expectArray(record["methods"], `${path}.methods`).map((item, index) =>
      parseMfaMethod(item, `${path}.methods[${index}]`),
    ),
    trustedDeviceAvailable: expectBoolean(record, "trustedDeviceAvailable", path),
    emailCodeAvailable: expectBoolean(record, "emailCodeAvailable", path),
    trustedDeviceDays: expectSafeInteger(record, "trustedDeviceDays", path),
  };
}

/**
 * The answer to the first step of a sign-in or a registration: the user when
 * that was enough, a challenge when a second factor is due, or the one status
 * that says only an operator's recovery credential gets back in.
 */
export function parseAuthResult(value: unknown, path: string): AuthResult {
  const payload = isRecord(value) && isRecord(value["user"]) && !("status" in value)
    ? value["user"]
    : value;
  if (isRecord(payload) && typeof payload["status"] === "string") {
    if (payload["status"] === "security_recovery_required") return { kind: "recovery-required" };
    return { kind: "challenge", challenge: parseMfaChallenge(payload, path) };
  }
  return { kind: "signed-in", user: parseUser(payload, path) };
}

export function parseMfaCompletion(value: unknown, path: string): MfaCompletion {
  const record = expectRecord(value, path);
  if (record["status"] !== "ok") {
    throw new ApiError("malformed", `${path}: a completed challenge says "ok"`);
  }
  const codes = record["recoveryCodes"];
  const trustedDeviceExpiresAt = optionalString(record, "trustedDeviceExpiresAt");
  return {
    user: parseUser(record["user"], `${path}.user`),
    ...(codes === null || codes === undefined
      ? {}
      : {
          recoveryCodes: expectArray(codes, `${path}.recoveryCodes`).map((code, index) => {
            if (typeof code !== "string") {
              throw new ApiError("malformed", `${path}.recoveryCodes[${index}] must be a string`);
            }
            return code;
          }),
        }),
    ...(trustedDeviceExpiresAt === undefined ? {} : { trustedDeviceExpiresAt }),
  };
}

export function parseMfaEnrollment(value: unknown, path: string): MfaEnrollment {
  const record = expectRecord(value, path);
  const secret = optionalString(record, "secret");
  const otpAuthUri = optionalString(record, "otpAuthUri");
  return {
    methodId: expectString(record, "methodId", path),
    type: oneOf(METHOD_TYPES, record, "type", path),
    ...(secret === undefined ? {} : { secret }),
    ...(otpAuthUri === undefined ? {} : { otpAuthUri }),
  };
}

/** Seconds until another email code may be asked for. */
export function parseEmailCodeSent(value: unknown, path: string): { retryAfterSeconds: number } {
  const record = expectRecord(value, path);
  const seconds = record["retryAfterSeconds"];
  return {
    retryAfterSeconds: typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 0,
  };
}
