export const PENDING_INVITE_STORAGE_KEY = "stellarr.pending-invite";

/**
 * An invite link opened while signed out has to survive the registration or
 * login that follows. It lives in `sessionStorage`, so it belongs to this tab
 * and is gone when the tab closes.
 *
 * Storage can be unavailable (locked-down browsers, some embedded views); the
 * visitor then signs in and lands on the home page, and the link still works
 * when opened again.
 */
export function rememberPendingInvite(code: string): void {
  try {
    window.sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, code);
  } catch {
    // See above: losing the invite is acceptable, failing the page is not.
  }
}

/** The remembered invite code, left in place. */
export function pendingInvite(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The remembered invite code, forgotten as it is read. */
export function takePendingInvite(): string | null {
  const code = pendingInvite();
  if (code === null) return null;
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // Nothing to forget if storage cannot be written.
  }
  return code;
}
