import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey, type MessageValues } from "@/i18n";
import type { SessionPhase } from "@/state/hooks";

import HomePage from "./page";

const mocks = vi.hoisted(() => ({
  session: {
    phase: "loading" as SessionPhase,
    error: null as string | null,
    reload: vi.fn(),
    logout: vi.fn(async () => {}),
  },
  router: { replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/state/hooks", () => ({
  useSession: () => mocks.session,
  useLanguage: () => ({
    t: (key: MessageKey, values?: MessageValues) => translateMessage("pl", key, values),
  }),
}));
vi.mock("@/containers/AppContainer", () => ({
  AppContainer: () => <div data-testid="app" />,
}));

function settleAs(phase: SessionPhase, error: string | null = null) {
  mocks.session.phase = phase;
  mocks.session.error = error;
}

beforeEach(() => {
  settleAs("loading");
  mocks.session.reload = vi.fn();
  mocks.session.logout = vi.fn(async () => {});
  mocks.router.replace.mockReset();
});

describe("HomePage", () => {
  it("opens the app once the session is ready", () => {
    settleAs("ready");
    render(<HomePage />);

    expect(screen.getByTestId("app")).toBeInTheDocument();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("explains a failed boot and offers a retry", async () => {
    settleAs("error", "Serwer nie odpowiada.");
    render(<HomePage />);

    expect(screen.getByText("Nie udało się wczytać serwera")).toBeInTheDocument();
    expect(screen.getByText("Serwer nie odpowiada.")).toBeInTheDocument();
    expect(screen.queryByTestId("app")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(mocks.session.reload).toHaveBeenCalledOnce();
    expect(mocks.session.logout).not.toHaveBeenCalled();
  });

  it("falls back to a generic hint when the failure has no message", () => {
    settleAs("error");
    render(<HomePage />);

    expect(
      screen.getByText("Sprawdź połączenie i spróbuj ponownie za chwilę."),
    ).toBeInTheDocument();
  });

  it("tells a revoked account so and offers to log out instead of retrying", async () => {
    settleAs("revoked", "To konto nie ma już dostępu do tego serwera.");
    render(<HomePage />);

    expect(screen.getByText("Brak dostępu do serwera")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Wyloguj się" }));

    expect(mocks.session.logout).toHaveBeenCalledOnce();
    expect(mocks.session.reload).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to the sign-in page", () => {
    settleAs("anonymous");
    render(<HomePage />);

    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    expect(screen.queryByTestId("app")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton while the session settles, without leaving", () => {
    settleAs("loading");
    render(<HomePage />);

    expect(screen.getByRole("status")).toHaveTextContent("Wczytywanie serwera…");
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
});
