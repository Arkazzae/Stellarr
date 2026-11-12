import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppGate } from "@/components/app-gate";
import { CockpitApiError } from "@/lib/api";
import { CockpitContext, type CockpitContextValue } from "@/state/cockpit-context";
import { selectPolish } from "@/test/locale";
import { cockpitValue } from "@/test/cockpit-fixtures";

function renderGate(value: CockpitContextValue) {
  return render(
    <MemoryRouter>
      <CockpitContext.Provider value={value}>
        <AppGate />
      </CockpitContext.Provider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Login"), "owner");
  await user.type(screen.getByLabelText("Hasło"), "sekret");
  await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
}

selectPolish();

describe("AppGate by phase", () => {
  it("shows the panel once the session is ready", () => {
    renderGate(cockpitValue({ phase: "ready" }));

    expect(screen.getAllByRole("navigation", { name: "Nawigacja Cockpitu" }).length).toBeGreaterThan(0);
  });

  it("shows a status line while loading", () => {
    renderGate(cockpitValue({ phase: "loading", bootstrap: null }));

    expect(screen.getByRole("status").textContent).toBe("Sprawdzanie dostępu do Cockpitu");
  });

  it("offers to sign out a forbidden account", async () => {
    const user = userEvent.setup();
    const value = cockpitValue({ phase: "forbidden", bootstrap: null });
    renderGate(value);

    expect(screen.getByText("To konto nie jest właścicielem")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Wyloguj konto" }));

    expect(value.logout).toHaveBeenCalledOnce();
  });

  it("sends an owner without the second step to confirm it in Stellarr with a full page load", () => {
    renderGate(cockpitValue({ phase: "mfa-required", bootstrap: null }));

    expect(screen.getByText("Cockpit wymaga drugiego kroku")).toBeTruthy();
    expect(screen.getByText(/zaufane urządzenie tu nie wystarcza/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Potwierdź drugim krokiem" });
    expect(link.getAttribute("href")).toBe("/login?confirm=1&returnUrl=%2Fcockpit%2F");
    expect(screen.queryByText("To konto nie jest właścicielem")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not offer the second step to an account that is not the owner", () => {
    renderGate(cockpitValue({ phase: "forbidden", bootstrap: null }));

    expect(screen.queryByRole("link", { name: "Potwierdź drugim krokiem" })).toBeNull();
  });

  it("shows the error and retries through reload", async () => {
    const user = userEvent.setup();
    const value = cockpitValue({ phase: "error", bootstrap: null, error: "Backend odpowiedział kodem 500." });
    renderGate(value);

    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(value.reload).toHaveBeenCalledOnce();
  });

  it("explains an error that carries no message", () => {
    renderGate(cockpitValue({ phase: "error", bootstrap: null, error: null }));

    expect(screen.getByText("Backend nie odpowiedział poprawnie.")).toBeTruthy();
  });
});

describe("AppGate sign-in form", () => {
  const anonymous = { phase: "anonymous", bootstrap: null } as const;

  it("submits the typed credentials and stays disabled while the session loads", async () => {
    const user = userEvent.setup();
    const value = cockpitValue({ ...anonymous, login: vi.fn(() => new Promise<void>(() => {})) });
    renderGate(value);

    await fillAndSubmit(user);

    expect(value.login).toHaveBeenCalledWith("owner", "sekret");
    const submit = screen.getByRole("button", { name: "Logowanie" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("maps HTTP 429 to the too-many-attempts message and re-enables the button", async () => {
    const user = userEvent.setup();
    renderGate(cockpitValue({ ...anonymous, login: vi.fn().mockRejectedValue(new CockpitApiError(429, "Too Many Requests")) }));

    await fillAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Za dużo prób logowania. Spróbuj ponownie za chwilę.",
    );
    const submit = await screen.findByRole("button", { name: "Zaloguj się" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the message of any other failure", async () => {
    const user = userEvent.setup();
    renderGate(cockpitValue({ ...anonymous, login: vi.fn().mockRejectedValue(new CockpitApiError(401, "Nieprawidłowy login lub hasło.")) }));

    await fillAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe("Nieprawidłowy login lub hasło.");
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    const user = userEvent.setup();
    renderGate(cockpitValue({ ...anonymous, login: vi.fn().mockRejectedValue("boom") }));

    await fillAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe("Logowanie nie powiodło się.");
  });

  it("clears the previous error when submitting again", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<CockpitContextValue["login"]>()
      .mockRejectedValueOnce(new CockpitApiError(401, "Nieprawidłowy login lub hasło."))
      .mockReturnValue(new Promise<void>(() => {}));
    renderGate(cockpitValue({ ...anonymous, login }));

    await fillAndSubmit(user);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(login).toHaveBeenCalledTimes(2);
  });
});
