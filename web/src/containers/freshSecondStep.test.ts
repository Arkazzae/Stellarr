import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Translator } from "@/i18n";
import { ApiError } from "@/lib/api/errors";

import { withFreshSecondStep } from "./freshSecondStep";

const leaveFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/leaveFor", () => ({ leaveFor }));

const t: Translator = (key) => key;

const notFresh = () =>
  new ApiError("forbidden", "/api/admin/server/transfer responded 403", 403, {
    code: "fresh-mfa-required",
  });

describe("withFreshSecondStep", () => {
  beforeEach(() => {
    leaveFor.mockReset();
    window.history.replaceState(null, "", "/servers/s-1?settings=members");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the result of a change that goes through", async () => {
    await expect(withFreshSecondStep(() => Promise.resolve("done"), t)).resolves.toBe("done");
    expect(leaveFor).not.toHaveBeenCalled();
  });

  it("offers to confirm the step and comes back to the same page", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await expect(withFreshSecondStep(() => Promise.reject(notFresh()), t)).resolves.toBeUndefined();

    expect(confirm).toHaveBeenCalledWith("settings.freshSecondStep");
    expect(leaveFor).toHaveBeenCalledExactlyOnceWith(
      `/login?confirm=1&fresh=1&returnUrl=${encodeURIComponent("/servers/s-1?settings=members")}`,
    );
  });

  it("stays put when the person declines", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await expect(withFreshSecondStep(() => Promise.reject(notFresh()), t)).resolves.toBeUndefined();

    expect(leaveFor).not.toHaveBeenCalled();
  });

  it("passes on any other refusal", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const other = new ApiError("forbidden", "/api/x responded 403", 403);

    await expect(withFreshSecondStep(() => Promise.reject(other), t)).rejects.toBe(other);

    expect(confirm).not.toHaveBeenCalled();
    expect(leaveFor).not.toHaveBeenCalled();
  });
});
