import type { Translator } from "@/i18n";
import { ApiError } from "@/lib/api/errors";

/**
 * Says why a step of a second-factor challenge failed, in the reader's
 * language. The API answers in English problem titles, so the status picks
 * the sentence. A 401 is left to the caller, which knows whether a wrong code
 * or an expired challenge is the likelier reading.
 */
export function challengeErrorMessage(cause: unknown, t: Translator, fallback: string): string {
  if (!(cause instanceof ApiError)) return fallback;
  if (cause.status === 429) {
    const seconds = cause.details?.["retryAfterSeconds"];
    return typeof seconds === "number" && seconds < 600
      ? t("auth.mfa.emailCooldown", { seconds })
      : t("auth.mfa.tooMany");
  }
  if (cause.status === 409) return t("auth.mfa.emailUnavailable");
  if (cause.status === 502) return t("auth.mfa.deliveryFailed");
  return fallback;
}
