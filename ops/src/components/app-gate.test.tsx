import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppGate } from "@/components/app-gate";
import { OpsApiError } from "@/lib/api";
import { OpsContext, type OpsContextValue } from "@/state/ops-context";
import { opsValue } from "@/test/ops-fixtures";

function renderGate(value: OpsContextValue) {
  return render(
    <MemoryRouter>
      <OpsContext.Provider value={value}>
        <AppGate />
      </OpsContext.Provider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Login"), "owner");
  await user.type(screen.getByLabelText("Hasło"), "sekret");
  await user.click(screen.getByRole("button", { name: "Zaloguj się" }));
}

describe("AppGate by phase", () => {
  it("shows the panel once the session is ready", () => {
    renderGate(opsValue({ phase: "ready" }));

    expect(screen.getAllByRole("navigation", { name: "Nawigacja OPs" }).length).toBeGreaterThan(0);
  });

  it("shows a status line while loading", () => {
    renderGate(opsValue({ phase: "loading", bootstrap: null }));

    expect(screen.getByRole("status").textContent).toBe("Sprawdzanie dostępu do OPs");
  });

  it("offers to sign out a forbidden account", async () => {
    const user = userEvent.setup();
    const value = opsValue({ phase: "forbidden", bootstrap: null });
    renderGate(value);

    expect(screen.getByText("To konto nie jest właścicielem")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Wyloguj konto" }));

    expect(value.logout).toHaveBeenCalledOnce();
  });

  it("shows the error and retries through reload", async () => {
    const user = userEvent.setup();
    const value = opsValue({ phase: "error", bootstrap: null, error: "Backend odpowiedział kodem 500." });
    renderGate(value);

    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(value.reload).toHaveBeenCalledOnce();
  });

  it("explains an error that carries no message", () => {
    renderGate(opsValue({ phase: "error", bootstrap: null, error: null }));

    expect(screen.getByText("Backend nie odpowiedział poprawnie.")).toBeTruthy();
  });
});

describe("AppGate sign-in form", () => {
  const anonymous = { phase: "anonymous", bootstrap: null } as const;

  it("submits the typed credentials and stays disabled while the session loads", async () => {
    const user = userEvent.setup();
    const value = opsValue({ ...anonymous, login: vi.fn(() => new Promise<void>(() => {})) });
    renderGate(value);

    await fillAndSubmit(user);

    expect(value.login).toHaveBeenCalledWith("owner", "sekret");
    const submit = screen.getByRole("button", { name: "Logowanie" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("maps HTTP 429 to the too-many-attempts message and re-enables the button", async () => {
    const user = userEvent.setup();
    renderGate(opsValue({ ...anonymous, login: vi.fn().mockRejectedValue(new OpsApiError(429, "Too Many Requests")) }));

    await fillAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Za dużo prób logowania. Spróbuj ponownie za chwilę.",
    );
    const submit = await screen.findByRole("button", { name: "Zaloguj się" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the message of any other failure", async () => {
    const user = userEvent.setup();
    renderGate(opsValue({ ...anonymous, login: vi.fn().mockRejectedValue(new OpsApiError(401, "Nieprawidłowy login lub hasło.")) }));

    await fillAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe("Nieprawidłowy login lub hasło.");
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    const user = userEvent.setup();
    renderGate(opsValue({ ...anonymous, login: vi.fn().mockRejectedValue("boom") }));

    await fillAndSubmit(user);

    expect((await screen.findByRole("alert")).textContent).toBe("Logowanie nie powiodło się.");
  });

  it("clears the previous error when submitting again", async () => {
    const user = userEvent.setup();
    const login = vi
      .fn<OpsContextValue["login"]>()
      .mockRejectedValueOnce(new OpsApiError(401, "Nieprawidłowy login lub hasło."))
      .mockReturnValue(new Promise<void>(() => {}));
    renderGate(opsValue({ ...anonymous, login }));

    await fillAndSubmit(user);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Zaloguj się" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(login).toHaveBeenCalledTimes(2);
  });
});
