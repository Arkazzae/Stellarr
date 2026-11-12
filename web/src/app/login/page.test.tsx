import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import type {
  AccountSecurity,
  AccountSecurityPort,
  AuthResult,
  MfaChallenge,
  SignInChallengePort,
} from "@/ports";
import type { SessionPhase } from "@/state/hooks";

import LoginPage from "./page";

const mocks = vi.hoisted(() => ({
  session: {
    phase: "anonymous" as SessionPhase,
    login: vi.fn(),
    reload: vi.fn(),
    loginPending: false,
    loginError: null as string | null,
  },
  challenge: {} as SignInChallengePort,
  security: {} as AccountSecurityPort,
  leaveFor: vi.fn(),
  router: { replace: vi.fn() },
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/lib/leaveFor", () => ({ leaveFor: mocks.leaveFor }));
vi.mock("@/state/hooks", () => ({
  useSession: () => mocks.session,
  usePorts: () => ({ session: { challenge: mocks.challenge }, security: mocks.security }),
  useLanguage: () => ({
    t: (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values),
  }),
}));

function answerOidc(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const configuration = (body: object) => Response.json(body);

const CHALLENGE: MfaChallenge = {
  enrollment: false,
  challengeId: "c-1",
  purpose: "mfa",
  expiresAt: "2026-11-12T17:12:30Z",
  methods: [
    {
      id: "m-app",
      type: "totp",
      name: "Telefon",
      createdAt: "2026-11-12T17:07:30Z",
      pending: false,
    },
    {
      id: "m-mail",
      type: "email",
      name: "E-mail",
      createdAt: "2026-11-12T17:07:30Z",
      emailAddress: "maja@example.test",
      pending: false,
    },
  ],
  trustedDeviceAvailable: false,
  emailCodeAvailable: true,
  trustedDeviceDays: 14,
};

const MAJA = { id: "u-1", username: "maja", displayName: "Maja", presence: "online" as const };

const t = (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values);

function fakeChallengePort(overrides: Partial<SignInChallengePort> = {}): SignInChallengePort {
  return {
    pending: vi.fn(async () => null),
    cancel: vi.fn(async () => {}),
    verify: vi.fn(async () => ({ user: MAJA })),
    sendEmailCode: vi.fn(async () => ({ retryAfterSeconds: 45 })),
    startTotp: vi.fn(async () => ({
      methodId: "m-new",
      type: "totp" as const,
      secret: "JBSWY3DPEHPK3PXP",
      otpAuthUri: "otpauth://totp/Stellarr%3Amaja?secret=JBSWY3DPEHPK3PXP",
    })),
    confirmTotp: vi.fn(async () => ({ user: MAJA, recoveryCodes: ["AAAA-BBBB", "CCCC-DDDD"] })),
    startEmail: vi.fn(async () => ({ retryAfterSeconds: 45 })),
    confirmEmail: vi.fn(async () => ({ user: MAJA })),
    redeemRecovery: vi.fn(async () => ({ ...CHALLENGE, enrollment: true, purpose: "recovery" as const, methods: [] })),
    ...overrides,
  };
}

const SECURE: AccountSecurity = {
  requirement: "cockpit",
  mfaRequired: false,
  freshMfa: false,
  methods: CHALLENGE.methods,
  remainingRecoveryCodes: 10,
  trustedDevices: [],
  recentEvents: [],
  trustedDeviceDays: 14,
  emailCodeAvailable: true,
};

function fakeSecurityPort(overrides: Partial<AccountSecurityPort> = {}): AccountSecurityPort {
  return {
    get: vi.fn(async () => SECURE),
    startEnrollment: vi.fn(async () => ({ ...CHALLENGE, enrollment: true, purpose: "enrollment" as const, methods: [] })),
    startReverification: vi.fn(async () => ({ ...CHALLENGE, purpose: "reverify" as const })),
    removeMethod: vi.fn(async () => {}),
    regenerateRecoveryCodes: vi.fn(async () => []),
    revokeTrustedDevice: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => {}),
    revokeOtherSessions: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.session.phase = "anonymous";
  mocks.session.login = vi.fn(async (): Promise<AuthResult> => ({ kind: "signed-in", user: MAJA }));
  mocks.session.reload = vi.fn();
  mocks.challenge = fakeChallengePort();
  mocks.security = fakeSecurityPort();
  mocks.leaveFor.mockReset();
  mocks.session.loginPending = false;
  mocks.session.loginError = null;
  mocks.search = "";
  mocks.router.replace.mockReset();
  answerOidc(configuration({ enabled: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("signs in with what was typed", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(await screen.findByRole("textbox", { name: "Login lub e-mail" }), "maja");
    await user.type(screen.getByLabelText("Hasło"), "haslo123");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));

    expect(mocks.session.login).toHaveBeenCalledExactlyOnceWith("maja", "haslo123");
  });

  it("shows the sign-in failure the session reports", async () => {
    mocks.session.loginError = "Nieprawidłowy login lub hasło.";

    render(<LoginPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Nieprawidłowy login lub hasło.");
  });

  it("shows no form while the session is being checked", () => {
    mocks.session.phase = "loading";

    render(<LoginPage />);

    expect(screen.getByText("Sprawdzanie sesji…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hasło")).not.toBeInTheDocument();
  });

  it("leaves for the app when a session already works", () => {
    mocks.session.phase = "ready";

    render(<LoginPage />);

    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("offers the external provider the instance reports, by its name", async () => {
    const fetchMock = answerOidc(configuration({ enabled: true, displayName: " Keycloak " }));

    render(<LoginPage />);

    const link = await screen.findByRole("link", { name: "Zaloguj przez Keycloak" });
    expect(link).toHaveAttribute("href", "/api/auth/oidc/login?returnUrl=%2F");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/oidc",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("falls back to a generic provider name when the instance gives none", async () => {
    answerOidc(configuration({ enabled: true, displayName: "  " }));

    render(<LoginPage />);

    expect(await screen.findByRole("link", { name: "Zaloguj przez konto główne" })).toBeVisible();
  });

  it.each([
    ["is switched off", () => answerOidc(configuration({ enabled: false }))],
    ["answers with an error", () => answerOidc(new Response("nope", { status: 500 }))],
    ["cannot be reached", () => answerOidc(new TypeError("offline"))],
  ])("offers only the password when the external provider %s", async (_case, arrange) => {
    const fetchMock = arrange();

    render(<LoginPage />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByLabelText("Hasło")).toBeInTheDocument();

    expect(screen.queryByRole("link", { name: /Zaloguj przez/ })).not.toBeInTheDocument();
  });

  it.each([
    ["not_linked", "To konto główne nie jest jeszcze połączone"],
    ["failed", "Logowanie przez konto główne nie powiodło się."],
  ])("explains an external sign-in that ended with %s", async (code, message) => {
    mocks.search = `oidc_error=${code}`;

    render(<LoginPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("ignores an unknown external sign-in error", async () => {
    mocks.search = "oidc_error=something_else";

    render(<LoginPage />);

    expect(await screen.findByLabelText("Hasło")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("LoginPage second factor", () => {
  async function signInTo(result: AuthResult) {
    const user = userEvent.setup();
    mocks.session.login = vi.fn(async () => result);
    render(<LoginPage />);
    await user.type(await screen.findByRole("textbox", { name: "Login lub e-mail" }), "maja");
    await user.type(screen.getByLabelText("Hasło"), "haslo123");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
    return user;
  }

  it("asks for the app code and loads the app only once it is accepted", async () => {
    const user = await signInTo({ kind: "challenge", challenge: CHALLENGE });

    expect(await screen.findByRole("heading", { name: t("auth.mfa.totpTitle") })).toBeVisible();
    expect(mocks.session.reload).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: t("auth.mfa.code") }), "123 456");
    await user.click(screen.getByRole("checkbox", { name: t("auth.mfa.remember", { days: 14 }) }));
    await user.click(screen.getByRole("button", { name: t("auth.mfa.submit") }));

    expect(mocks.challenge.verify).toHaveBeenCalledExactlyOnceWith({
      challengeId: "c-1",
      methodId: "m-app",
      code: "123456",
      rememberDevice: true,
    });
    await waitFor(() => expect(mocks.session.reload).toHaveBeenCalledOnce());
  });

  it("says the code is wrong and stays on the challenge while it is still pending", async () => {
    mocks.challenge = fakeChallengePort({
      verify: vi.fn(async () => {
        throw new ApiError("unauthorized", "401", 401);
      }),
      pending: vi
        .fn<SignInChallengePort["pending"]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(CHALLENGE),
    });
    const user = await signInTo({ kind: "challenge", challenge: CHALLENGE });

    await user.type(await screen.findByRole("textbox", { name: t("auth.mfa.code") }), "000000");
    await user.click(screen.getByRole("button", { name: t("auth.mfa.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("auth.mfa.codeInvalid"));
    expect(screen.getByRole("heading", { name: t("auth.mfa.totpTitle") })).toBeVisible();
    expect(mocks.session.reload).not.toHaveBeenCalled();
  });

  it("goes back to the password when the challenge has run out", async () => {
    mocks.challenge = fakeChallengePort({
      verify: vi.fn(async () => {
        throw new ApiError("unauthorized", "401", 401);
      }),
    });
    const user = await signInTo({ kind: "challenge", challenge: CHALLENGE });

    await user.type(await screen.findByRole("textbox", { name: t("auth.mfa.code") }), "000000");
    await user.click(screen.getByRole("button", { name: t("auth.mfa.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("auth.mfa.expired"));
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
  });

  it("sends an email code on request and counts down to the next one", async () => {
    const user = await signInTo({ kind: "challenge", challenge: CHALLENGE });

    await user.click(await screen.findByRole("button", { name: t("auth.mfa.useEmail") }));
    expect(screen.getByText(t("auth.mfa.emailDescription", { address: "maja@example.test" }))).toBeVisible();
    await user.click(screen.getByRole("button", { name: t("auth.mfa.sendEmail") }));

    expect(mocks.challenge.sendEmailCode).toHaveBeenCalledExactlyOnceWith("c-1", "m-mail");
    expect(await screen.findByRole("button", { name: t("auth.mfa.resendIn", { seconds: 45 }) })).toBeDisabled();
  });

  it("takes a recovery code without a method", async () => {
    const user = await signInTo({ kind: "challenge", challenge: CHALLENGE });

    await user.click(await screen.findByRole("button", { name: t("auth.mfa.useRecovery") }));
    await user.type(screen.getByRole("textbox", { name: t("auth.mfa.recoveryCode") }), "AAAA-BBBB");
    await user.click(screen.getByRole("button", { name: t("auth.mfa.submit") }));

    expect(mocks.challenge.verify).toHaveBeenCalledExactlyOnceWith({
      challengeId: "c-1",
      code: "AAAA-BBBB",
      rememberDevice: false,
    });
  });

  it("asks again when the ports are replaced before the first answer comes", async () => {
    let answerFirst: (challenge: MfaChallenge | null) => void = () => undefined;
    mocks.challenge = fakeChallengePort({
      pending: vi.fn(() => new Promise<MfaChallenge | null>((resolve) => (answerFirst = resolve))),
    });
    const view = render(<LoginPage />);
    // A sign-out elsewhere hands the page new ports while it is still asking.
    mocks.challenge = fakeChallengePort();
    view.rerender(<LoginPage />);
    answerFirst(null);

    expect(await screen.findByLabelText("Hasło")).toBeInTheDocument();
  });

  it("resumes a challenge this browser left unfinished", async () => {
    mocks.challenge = fakeChallengePort({ pending: vi.fn(async () => CHALLENGE) });
    render(<LoginPage />);

    expect(await screen.findByRole("heading", { name: t("auth.mfa.totpTitle") })).toBeVisible();
    expect(screen.queryByLabelText("Hasło")).toBeNull();
  });

  it("cancels on the server and returns to the password", async () => {
    const user = await signInTo({ kind: "challenge", challenge: CHALLENGE });

    await user.click(await screen.findByRole("button", { name: t("auth.mfa.cancel") }));

    expect(mocks.challenge.cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
  });

  it("sets up an app, shows the recovery codes once, and loads the app after they are saved", async () => {
    const user = await signInTo({
      kind: "challenge",
      challenge: { ...CHALLENGE, enrollment: true, purpose: "enrollment", methods: [] },
    });

    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeVisible();
    expect(screen.getByRole("img", { name: t("auth.enroll.qrLabel") })).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: t("auth.mfa.code") }), "123456");
    await user.click(screen.getByRole("button", { name: t("auth.enroll.confirm") }));

    expect(mocks.challenge.confirmTotp).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ challengeId: "c-1", methodId: "m-new", code: "123456" }),
    );
    expect(await screen.findByText("AAAA-BBBB")).toBeVisible();
    const done = screen.getByRole("button", { name: t("auth.codes.continue") });
    expect(done).toBeDisabled();
    expect(mocks.session.reload).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: t("auth.codes.saved") }));
    await user.click(done);

    expect(mocks.session.reload).toHaveBeenCalledOnce();
  });

  it("trades an operator's recovery credential for a replacement setup", async () => {
    mocks.search = "security_recovery_required=1";
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByRole("textbox", { name: t("auth.recover.credential") }), " abc ");
    await user.click(screen.getByRole("button", { name: t("auth.recover.submit") }));

    expect(mocks.challenge.redeemRecovery).toHaveBeenCalledExactlyOnceWith("abc");
    expect(await screen.findByRole("heading", { name: t("auth.enroll.recoveryTitle") })).toBeVisible();
  });

  it("says a spent recovery credential does not work", async () => {
    mocks.search = "security_recovery_required=1";
    mocks.challenge = fakeChallengePort({
      redeemRecovery: vi.fn(async () => {
        throw new ApiError("unauthorized", "401", 401);
      }),
    });
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByRole("textbox", { name: t("auth.recover.credential") }), "abc");
    await user.click(screen.getByRole("button", { name: t("auth.recover.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("auth.recover.invalid"));
  });

  it("carries only a same-origin return path to the identity provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => configuration({ enabled: true, displayName: "Authentik" })));
    mocks.search = "returnUrl=%2F%2Fevil.example";
    const { unmount } = render(<LoginPage />);
    expect(await screen.findByRole("link", { name: /Authentik/ })).toHaveAttribute(
      "href",
      "/api/auth/oidc/login?returnUrl=%2F",
    );
    unmount();

    mocks.search = "returnUrl=%2Fcockpit%2F";
    render(<LoginPage />);
    expect(await screen.findByRole("link", { name: /Authentik/ })).toHaveAttribute(
      "href",
      "/api/auth/oidc/login?returnUrl=%2Fcockpit%2F",
    );
  });
});

describe("LoginPage confirming a signed-in session", () => {
  beforeEach(() => {
    mocks.session.phase = "ready";
    mocks.search = "confirm=1&returnUrl=%2Fcockpit%2F";
  });

  it("goes back at once when the session already passed a real second step", async () => {
    mocks.security = fakeSecurityPort({
      get: vi.fn(async () => ({ ...SECURE, mfaEvidence: "totp", mfaCompletedAt: "2026-11-12T17:00:00Z" })),
    });
    render(<LoginPage />);

    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledExactlyOnceWith("/cockpit/"));
    expect(mocks.security.startReverification).not.toHaveBeenCalled();
  });

  it("asks a trusted-device session for a fresh code, without offering trust, then goes back", async () => {
    mocks.security = fakeSecurityPort({
      get: vi.fn(async () => ({ ...SECURE, mfaEvidence: "trusted_device", mfaCompletedAt: "2026-11-12T17:00:00Z" })),
    });
    const user = userEvent.setup();
    render(<LoginPage />);

    expect(await screen.findByRole("heading", { name: t("auth.mfa.totpTitle") })).toBeVisible();
    expect(mocks.leaveFor).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: t("auth.mfa.code") }), "123456");
    await user.click(screen.getByRole("button", { name: t("auth.mfa.submit") }));

    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledExactlyOnceWith("/cockpit/"));
    expect(mocks.session.reload).not.toHaveBeenCalled();
  });

  it("asks for the password before setting up a first method", async () => {
    mocks.security = fakeSecurityPort({
      get: vi.fn(async () => ({ ...SECURE, methods: [] })),
      startEnrollment: vi
        .fn<AccountSecurityPort["startEnrollment"]>()
        .mockRejectedValueOnce(new ApiError("forbidden", "403", 403))
        .mockResolvedValue({ ...CHALLENGE, enrollment: true, purpose: "enrollment", methods: [] }),
    });
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(await screen.findByLabelText("Hasło"), "haslo123");
    await user.click(screen.getByRole("button", { name: t("security.password.submit") }));

    expect(mocks.security.startEnrollment).toHaveBeenLastCalledWith("haslo123");
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeVisible();
  });
});
