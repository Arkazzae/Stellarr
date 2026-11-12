import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rememberPendingInvite } from "@/lib/invites";
import { translateMessage, type MessageKey } from "@/i18n";
import type { SessionPhase } from "@/state/hooks";

import RegistrationPage from "./page";

const mocks = vi.hoisted(() => ({
  session: { phase: "anonymous" as SessionPhase, reload: vi.fn() },
  ports: { session: { register: vi.fn() } },
  router: { replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/state/hooks", () => ({
  useSession: () => mocks.session,
  usePorts: () => mocks.ports,
  useLanguage: () => ({ t: (key: MessageKey) => translateMessage("pl", key) }),
}));

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Nazwa widoczna" }), "Maja");
  await user.type(screen.getByRole("textbox", { name: "Login" }), "maja");
  await user.type(screen.getByRole("textbox", { name: "E-mail" }), "maja@example.com");
  await user.type(screen.getByLabelText("Hasło"), "haslo123");
  await user.type(screen.getByLabelText("Powtórz hasło"), "haslo123");
  await user.click(screen.getByRole("button", { name: "Załóż konto" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.phase = "anonymous";
  window.sessionStorage.clear();
});

describe("RegistrationPage", () => {
  it("registers the account and asks the session to start over", async () => {
    mocks.ports.session.register.mockResolvedValue({ kind: "signed-in", user: { id: "u-1", username: "maja", displayName: "Maja", presence: "online" } });
    render(<RegistrationPage />);

    await fillAndSubmit();

    expect(mocks.ports.session.register).toHaveBeenCalledExactlyOnceWith({
      displayName: "Maja",
      username: "maja",
      email: "maja@example.com",
      password: "haslo123",
    });
    expect(mocks.session.reload).toHaveBeenCalledOnce();
  });

  it("registers with the invite the visitor arrived with and keeps it for the redirect", async () => {
    mocks.ports.session.register.mockResolvedValue({ kind: "signed-in", user: { id: "u-1", username: "maja", displayName: "Maja", presence: "online" } });
    rememberPendingInvite("abc123");
    render(<RegistrationPage />);

    await fillAndSubmit();

    expect(mocks.ports.session.register).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCode: "abc123" }),
    );
    expect(window.sessionStorage.getItem("stellarr.pending-invite")).toBe("abc123");
  });

  it("leaves a required second-step setup to the sign-in page, without starting the app", async () => {
    mocks.ports.session.register.mockResolvedValue({
      kind: "challenge",
      challenge: { enrollment: true, challengeId: "c-1", purpose: "enrollment", methods: [] },
    });
    render(<RegistrationPage />);

    await fillAndSubmit();

    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    expect(mocks.session.reload).not.toHaveBeenCalled();
  });

  it("says the account could not be created when the server refuses", async () => {
    mocks.ports.session.register.mockRejectedValue(new Error("taken"));
    render(<RegistrationPage />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się założyć konta.");
    expect(mocks.session.reload).not.toHaveBeenCalled();
  });

  it("moves on to the invite once the new session is ready", () => {
    mocks.session.phase = "ready";
    rememberPendingInvite("abc123");

    render(<RegistrationPage />);

    expect(mocks.router.replace).toHaveBeenCalledExactlyOnceWith("/invite/abc123");
  });
});
