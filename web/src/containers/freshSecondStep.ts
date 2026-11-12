import type { Translator } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { leaveFor } from "@/lib/leaveFor";

/** The problem code of a change refused for want of a second step from the last few minutes. */
export const FRESH_SECOND_STEP_REQUIRED = "fresh-mfa-required";

/**
 * Runs a sensitive change. When the server wants a fresh second step first,
 * offers to confirm it on the sign-in page, which brings the person back to
 * this page to make the change again; any other failure is passed on.
 */
export async function withFreshSecondStep<T>(change: () => Promise<T>, t: Translator): Promise<T | undefined> {
  try {
    return await change();
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.code !== FRESH_SECOND_STEP_REQUIRED) throw cause;
    if (window.confirm(t("settings.freshSecondStep"))) {
      const back = `${window.location.pathname}${window.location.search}`;
      leaveFor(`/login?confirm=1&fresh=1&returnUrl=${encodeURIComponent(back)}`);
    }
    return undefined;
  }
}
