import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import type { SessionPhase } from "@/state/hooks";

import LoginPage from "./page";

const mocks = vi.hoisted(() => ({
  session: {
    phase: "anonymous" as SessionPhase,
    login: vi.fn(),
    loginPending: false,
    loginError: null as string | null,
  },
  router: { replace: vi.fn() },
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/state/hooks", () => ({
  useSession: () => mocks.session,
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

beforeEach(() => {
  mocks.session.phase = "anonymous";
  mocks.session.login = vi.fn(async () => true);
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

    await user.type(screen.getByRole("textbox", { name: "Login lub e-mail" }), "maja");
    await user.type(screen.getByLabelText("Hasło"), "haslo123");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));

    expect(mocks.session.login).toHaveBeenCalledExactlyOnceWith("maja", "haslo123");
  });

  it("shows the sign-in failure the session reports", () => {
    mocks.session.loginError = "Nieprawidłowy login lub hasło.";

    render(<LoginPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nieprawidłowy login lub hasło.");
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("link", { name: /Zaloguj przez/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Hasło")).toBeInTheDocument();
  });

  it.each([
    ["not_linked", "To konto główne nie jest jeszcze połączone"],
    ["failed", "Logowanie przez konto główne nie powiodło się."],
  ])("explains an external sign-in that ended with %s", (code, message) => {
    mocks.search = `oidc_error=${code}`;

    render(<LoginPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("ignores an unknown external sign-in error", () => {
    mocks.search = "oidc_error=something_else";

    render(<LoginPage />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
