import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PENDING_INVITE_STORAGE_KEY,
  pendingInvite,
  rememberPendingInvite,
  takePendingInvite,
} from "./invites";

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("pending invites", () => {
  it("has nothing pending until an invite is remembered", () => {
    expect(pendingInvite()).toBeNull();
    expect(takePendingInvite()).toBeNull();
  });

  it("keeps a remembered invite for this tab under the shared key", () => {
    rememberPendingInvite("abc123");

    expect(window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBe("abc123");
    expect(pendingInvite()).toBe("abc123");
    expect(pendingInvite()).toBe("abc123");
  });

  it("forgets an invite once it has been taken", () => {
    rememberPendingInvite("abc123");

    expect(takePendingInvite()).toBe("abc123");
    expect(takePendingInvite()).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBeNull();
  });

  it("replaces an earlier invite with the latest one", () => {
    rememberPendingInvite("first");
    rememberPendingInvite("second");

    expect(takePendingInvite()).toBe("second");
  });

  it("carries on without an invite when the browser refuses storage", () => {
    const refusing = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: refusing,
      setItem: refusing,
      removeItem: refusing,
    });

    expect(() => rememberPendingInvite("abc123")).not.toThrow();
    expect(pendingInvite()).toBeNull();
    expect(takePendingInvite()).toBeNull();
  });
});
