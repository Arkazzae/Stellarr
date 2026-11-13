import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PENDING_INVITE_STORAGE_KEY,
  inviteExpiry,
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

describe("inviteExpiry", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");

  it("counts in the coarsest unit that fits", () => {
    expect(inviteExpiry("2026-11-13T12:20:00Z", now)).toEqual({ state: "later", value: 20, unit: "minute" });
    expect(inviteExpiry("2026-11-13T17:00:00Z", now)).toEqual({ state: "later", value: 5, unit: "hour" });
    expect(inviteExpiry("2026-11-20T12:00:00Z", now)).toEqual({ state: "later", value: 7, unit: "day" });
  });

  it("tells a link that never expires from one that already has", () => {
    expect(inviteExpiry(null, now)).toEqual({ state: "never" });
    expect(inviteExpiry("not a date", now)).toEqual({ state: "never" });
    expect(inviteExpiry("2026-11-13T11:59:00Z", now)).toEqual({ state: "expired" });
  });
});
