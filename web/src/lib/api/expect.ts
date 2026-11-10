import { ApiError } from "./errors";

/**
 * Narrowing helpers shared by the transport and the wire parsers. A value that
 * does not have the shape a parser needs is an `ApiError` of kind `malformed`,
 * naming the request path so the failure can be traced to an endpoint.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts either a bare entity or a single-key envelope (`{ "user": {...} }`).
 * Endpoints differ in which of the two they answer with.
 */
export function unwrap(payload: unknown, key: string): unknown {
  return isRecord(payload) && key in payload ? payload[key] : payload;
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError("malformed", `${path} returned an unexpected shape`);
  }
  return value;
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError("malformed", `${path} returned an unexpected shape`);
  }
  return value;
}

export function expectString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new ApiError("malformed", `${path}: "${key}" must be a string`);
  }
  return value;
}

export function expectNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const value = optionalNumber(source, key);
  if (value === undefined) {
    throw new ApiError("malformed", `${path}: "${key}" must be a finite number`);
  }
  return value;
}

export function expectBoolean(
  source: Record<string, unknown>,
  key: string,
  path: string,
): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    throw new ApiError("malformed", `${path}: "${key}" must be a boolean`);
  }
  return value;
}

export function expectSafeInteger(
  source: Record<string, unknown>,
  key: string,
  path: string,
  minimum = 0,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new ApiError("malformed", `${path}: "${key}" must be a safe integer`);
  }
  return value;
}

export function optionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

export function optionalNumber(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Spread into an object literal so an absent field stays absent, not `undefined`. */
export function definedField<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}
