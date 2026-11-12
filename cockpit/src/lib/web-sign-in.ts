import type { CockpitLoginStep } from "@/lib/api";

/*
 * The web client's sign-in page, on the same origin: in production Cockpit is
 * served under /cockpit/, so the page shares Cockpit's session and comes back
 * here once the step is done.
 */
const BACK_TO_COCKPIT = `returnUrl=${encodeURIComponent("/cockpit/")}`;

/** Where a sign-in the password did not finish goes on; the page resumes the pending step. */
export function webSignInUrl(step: CockpitLoginStep): string {
  return step === "security_recovery_required"
    ? `/login?${BACK_TO_COCKPIT}&security_recovery_required=1`
    : `/login?${BACK_TO_COCKPIT}`;
}

/** Where a signed-in owner confirms a second step, or sets up a first method, for Cockpit. */
export const WEB_CONFIRM_URL = `/login?confirm=1&${BACK_TO_COCKPIT}`;

/** A full page load: the sign-in page belongs to the web client, not to this app. */
export function leaveFor(path: string): void {
  window.location.assign(path);
}
