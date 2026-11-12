import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { PasskeyCancelledError } from "@/lib/webauthn";
import type { AccountSecurity, AccountSecurityPort, MfaChallenge, SignInChallengePort } from "@/ports";

import { useAccountSecurity } from "./useAccountSecurity";

const mocks = vi.hoisted(() => ({
  security: {} as AccountSecurityPort,
  challenge: {} as SignInChallengePort,
}));

vi.mock("@/state/hooks", () => ({
  usePorts: () => ({
    security: mocks.security,
    session: { challenge: mocks.challenge, passkeysSupported: () => false },
  }),
  useLanguage: () => ({
    t: (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values),
  }),
}));

const t = (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values);
const forbidden = () => new ApiError("forbidden", "403", 403);

const MAJA = { id: "u-1", username: "maja", displayName: "Maja", presence: "online" as const };

const APP = {
  id: "m-app",
  type: "totp" as const,
  name: "Telefon",
  createdAt: "2026-11-12T17:00:00Z",
  pending: false,
};

const state = (overrides: Partial<AccountSecurity> = {}): AccountSecurity => ({
  requirement: "optional",
  mfaRequired: false,
  freshMfa: false,
  methods: [APP],
  remainingRecoveryCodes: 10,
  trustedDevices: [],
  recentEvents: [],
  trustedDeviceDays: 14,
  passkeyAvailable: false,
  emailCodeAvailable: false,
  ...overrides,
});

const challenge = (purpose: MfaChallenge["purpose"]): MfaChallenge => ({
  enrollment: purpose === "enrollment",
  challengeId: `c-${purpose}`,
  purpose,
  expiresAt: "2026-11-12T17:10:00Z",
  methods: purpose === "enrollment" ? [] : [APP],
  trustedDeviceAvailable: false,
  emailCodeAvailable: false,
  trustedDeviceDays: 14,
  passkeyAvailable: false,
});

beforeEach(() => {
  mocks.security = {
    get: vi.fn(async () => state()),
    startEnrollment: vi.fn(async () => challenge("enrollment")),
    startReverification: vi.fn(async () => challenge("reverify")),
    removeMethod: vi.fn(async () => {}),
    regenerateRecoveryCodes: vi.fn(async () => ["AAAA-BBBB"]),
    revokeTrustedDevice: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => {}),
    revokeOtherSessions: vi.fn(async () => {}),
  };
  mocks.challenge = {
    pending: vi.fn(async () => null),
    cancel: vi.fn(async () => {}),
    verify: vi.fn(async () => ({ user: MAJA })),
    sendEmailCode: vi.fn(async () => ({ retryAfterSeconds: 45 })),
    startTotp: vi.fn(async () => ({ methodId: "m-new", type: "totp" as const, secret: "JBSWY3DPEHPK3PXP" })),
    confirmTotp: vi.fn(async () => ({ user: MAJA })),
    startEmail: vi.fn(async () => ({ retryAfterSeconds: 45 })),
    confirmEmail: vi.fn(async () => ({ user: MAJA })),
    redeemRecovery: vi.fn(async () => challenge("recovery")),
    answerWithPasskey: vi.fn(async () => ({ user: MAJA })),
    createPasskey: vi.fn(async () => ({ user: MAJA })),
  };
});

async function mounted() {
  const hook = renderHook(() => useAccountSecurity(true));
  await waitFor(() => expect(hook.result.current.sections.security).not.toBeNull());
  return hook;
}

describe("useAccountSecurity", () => {
  it("asks for a fresh code before adding a method, then opens the setup", async () => {
    vi.mocked(mocks.security.startEnrollment).mockRejectedValueOnce(forbidden());
    const { result } = await mounted();

    act(() => result.current.sections.onAddMethod());
    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("reverify"));

    act(() => result.current.dialog.onVerify({ methodId: "m-app", code: "123456", rememberDevice: true }));

    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("enroll"));
    // A proof before a change never trusts the device.
    expect(mocks.challenge.verify).toHaveBeenCalledWith({
      challengeId: "c-reverify",
      methodId: "m-app",
      code: "123456",
      rememberDevice: false,
    });
    expect(mocks.security.startEnrollment).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.challenge.startTotp).toHaveBeenCalledWith("c-enrollment", expect.any(String)));
  });

  it("takes a passkey as the fresh proof, without trusting the device, then opens the setup", async () => {
    vi.mocked(mocks.security.startEnrollment).mockRejectedValueOnce(forbidden());
    const { result } = await mounted();

    act(() => result.current.sections.onAddMethod());
    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("reverify"));
    act(() => result.current.dialog.onAnswerWithPasskey());

    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("enroll"));
    expect(mocks.challenge.answerWithPasskey).toHaveBeenCalledExactlyOnceWith({ challengeId: "c-reverify" });
    expect(mocks.security.startEnrollment).toHaveBeenCalledTimes(2);
  });

  it("says a closed passkey prompt was not used and keeps the proof step open", async () => {
    vi.mocked(mocks.security.startEnrollment).mockRejectedValueOnce(forbidden());
    vi.mocked(mocks.challenge.answerWithPasskey).mockRejectedValueOnce(new PasskeyCancelledError());
    const { result } = await mounted();

    act(() => result.current.sections.onAddMethod());
    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("reverify"));
    act(() => result.current.dialog.onAnswerWithPasskey());

    await waitFor(() => expect(result.current.dialog.error).toBe(t("auth.passkey.cancelled")));
    expect(result.current.dialog.step?.kind).toBe("reverify");
  });

  it("asks for the password before the first method, and says so when it is wrong", async () => {
    vi.mocked(mocks.security.get).mockResolvedValue(state({ methods: [] }));
    vi.mocked(mocks.security.startEnrollment)
      .mockRejectedValueOnce(forbidden())
      .mockRejectedValueOnce(forbidden())
      .mockResolvedValueOnce(challenge("enrollment"));
    const { result } = await mounted();

    act(() => result.current.sections.onAddMethod());
    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("password"));
    expect(mocks.security.startReverification).not.toHaveBeenCalled();

    act(() => result.current.dialog.onPassword("zle"));
    await waitFor(() => expect(result.current.dialog.error).toBe(t("security.password.wrong")));

    act(() => result.current.dialog.onPassword("dobre"));
    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("enroll"));
    expect(mocks.security.startEnrollment).toHaveBeenLastCalledWith("dobre");
  });

  it("shows new recovery codes once they are generated", async () => {
    const { result } = await mounted();

    act(() => result.current.sections.onRegenerateCodes());

    await waitFor(() => expect(result.current.dialog.step).toEqual({ kind: "codes", codes: ["AAAA-BBBB"] }));
  });

  it("explains why the last required method cannot go", async () => {
    vi.mocked(mocks.security.removeMethod).mockRejectedValueOnce(new ApiError("invalid", "409", 409));
    const { result } = await mounted();

    act(() => result.current.sections.onRemoveMethod(APP));

    await waitFor(() =>
      expect(result.current.sections.actionError).toBe(t("security.method.lastRequired")),
    );
    expect(result.current.dialog.step).toBeNull();
  });

  it("says when the server asks to wait instead of a generic failure", async () => {
    vi.mocked(mocks.security.regenerateRecoveryCodes).mockRejectedValueOnce(
      new ApiError("rate-limited", "429", 429),
    );
    const { result } = await mounted();

    act(() => result.current.sections.onRegenerateCodes());

    await waitFor(() => expect(result.current.sections.actionError).toBe(t("auth.mfa.tooMany")));
  });

  it("cancels an open setup on the server when the dialog is closed", async () => {
    const { result } = await mounted();

    act(() => result.current.sections.onAddMethod());
    await waitFor(() => expect(result.current.dialog.step?.kind).toBe("enroll"));
    act(() => result.current.dialog.onClose());

    expect(mocks.challenge.cancel).toHaveBeenCalledOnce();
    expect(result.current.dialog.step).toBeNull();
  });
});
