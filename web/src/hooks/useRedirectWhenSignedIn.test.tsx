import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PENDING_INVITE_STORAGE_KEY, rememberPendingInvite } from "@/lib/invites";
import type { SessionPhase } from "@/state/hooks";

import { useRedirectWhenSignedIn } from "./useRedirectWhenSignedIn";

const replace = vi.fn();
const router = { replace };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  replace.mockReset();
  window.sessionStorage.clear();
});

describe("useRedirectWhenSignedIn", () => {
  it.each<SessionPhase>(["loading", "anonymous", "error", "revoked"])(
    "stays where it is while the session is %s",
    (phase) => {
      rememberPendingInvite("abc123");

      renderHook(() => useRedirectWhenSignedIn(phase));

      expect(replace).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBe("abc123");
    },
  );

  it("goes home once the session is ready and no invite is waiting", () => {
    renderHook(() => useRedirectWhenSignedIn("ready"));

    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("goes to the invite the visitor came with and forgets it", () => {
    rememberPendingInvite("a/b c");

    renderHook(() => useRedirectWhenSignedIn("ready"));

    expect(replace).toHaveBeenCalledExactlyOnceWith("/invite/a%2Fb%20c");
    expect(window.sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)).toBeNull();
  });

  it("redirects when the session turns ready after sign-in", () => {
    const { rerender } = renderHook(({ phase }) => useRedirectWhenSignedIn(phase), {
      initialProps: { phase: "anonymous" as SessionPhase },
    });
    expect(replace).not.toHaveBeenCalled();

    rerender({ phase: "ready" });

    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
  });
});
