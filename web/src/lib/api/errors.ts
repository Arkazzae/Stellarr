import type { MessageKey, Translator } from "@/i18n";

export type ApiErrorKind =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "invalid"
  | "too-large"
  | "unsupported-media"
  | "rate-limited"
  | "server"
  | "malformed";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status; 0 when no response arrived. */
  readonly status: number;
  /**
   * The machine-readable reason, when the server answered with ProblemDetails
   * carrying one in `title`.
   */
  readonly code?: string;
  /** The `details` extension of the ProblemDetails, when present. */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status = 0,
    problem?: { code?: string; details?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    if (problem?.code !== undefined) this.code = problem.code;
    if (problem?.details !== undefined) this.details = problem.details;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "unauthorized";
}

export function statusToKind(status: number): ApiErrorKind {
  switch (status) {
    case 400:
    case 422:
      return "invalid";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 413:
      return "too-large";
    case 415:
      return "unsupported-media";
    case 429:
      return "rate-limited";
    default:
      return "server";
  }
}

const API_ERROR_MESSAGE: Record<ApiErrorKind, MessageKey> = {
  network: "session.network",
  unauthorized: "session.unauthorized",
  forbidden: "session.forbidden",
  "not-found": "session.notFound",
  invalid: "session.invalid",
  "too-large": "api.tooLarge",
  "unsupported-media": "api.unsupportedMedia",
  "rate-limited": "session.rateLimited",
  malformed: "session.malformed",
  server: "session.server",
};

/**
 * A sentence the reader can act on. An `ApiError` gets the catalog message for
 * its kind; anything else gets the caller's own `fallback`.
 */
export function describeError(
  error: unknown,
  fallback: string,
  translator: Translator,
): string {
  return error instanceof ApiError
    ? translator(API_ERROR_MESSAGE[error.kind])
    : fallback;
}
