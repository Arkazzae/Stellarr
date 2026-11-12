import type { CockpitLoginStep } from "@/lib/api";

/*
 * The web client's sign-in page, on the same origin: in production Cockpit is
 * served under /cockpit/, so the page shares Cockpit's session and comes back
 * here once the step is done.
 */
const BACK_TO_COCKPIT = `returnUrl=${encodeURIComponent("/cockpit/")}`;

/**
 * Where a sign-in the password did not finish goes on; the page resumes the
 * pending step. A challenge already holds the keep-signed-in choice on the
 * server; an operator's recovery has none yet, so the address carries it.
 */
export function webSignInUrl(step: CockpitLoginStep, keepSignedIn = true): string {
  if (step !== "security_recovery_required") return `/login?${BACK_TO_COCKPIT}`;
  const recovery = `/login?${BACK_TO_COCKPIT}&security_recovery_required=1`;
  return keepSignedIn ? recovery : `${recovery}&keep_signed_in=0`;
}

/** Where a signed-in owner confirms a second step, or sets up a first method, for Cockpit. */
export const WEB_CONFIRM_URL = `/login?confirm=1&${BACK_TO_COCKPIT}`;

/**
 * Where an owner confirms a second step from the last few minutes before a
 * sensitive change, coming back to the page that asked for it.
 */
export function webFreshConfirmUrl(returnPath: string): string {
  return `/login?confirm=1&fresh=1&returnUrl=${encodeURIComponent(returnPath)}`;
}

/** A full page load: the sign-in page belongs to the web client, not to this app. */
export function leaveFor(path: string): void {
  window.location.assign(path);
}
