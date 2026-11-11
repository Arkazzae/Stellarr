import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitSettings } from "@/lib/api";
import { IntegrationsPage } from "@/pages/integrations-page";
import { selectPolish } from "@/test/locale";
import { secret, secrets } from "@/test/secrets";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: {
      ...original.cockpitApi,
      settings: vi.fn(),
      updateSettings: vi.fn(),
      secrets: vi.fn(),
      setSecret: vi.fn(),
      clearSecret: vi.fn(),
    },
  };
});

const settingsMock = vi.mocked(cockpitApi.settings);
const updateMock = vi.mocked(cockpitApi.updateSettings);
const secretsMock = vi.mocked(cockpitApi.secrets);
const setSecretMock = vi.mocked(cockpitApi.setSecret);
const clearSecretMock = vi.mocked(cockpitApi.clearSecret);

const stored: CockpitSettings = {
  instanceName: "Domek",
  publicUrl: "https://domek.example.net",
  timeZone: "Europe/Warsaw",
  mailingEnabled: true,
  mailProvider: "smtp",
  mailFromAddress: "stellarr@example.net",
  resendApiKeyConfigured: true,
  resendEnabled: false,
  smtpHost: "smtp.example.net",
  smtpPort: 587,
  smtpSecurity: "starttls",
  smtpUsername: "",
  smtpPasswordConfigured: false,
  mailReady: true,
  inviteMailEnabled: true,
  recoveryMailEnabled: true,
  alertMailEnabled: false,
  backupRetentionDays: 14,
  logRetentionDays: 30,
  orphanObjectRetentionDays: 7,
  automaticCleanupEnabled: true,
  updatedAt: "2025-03-01T10:00:00Z",
};

beforeEach(() => {
  settingsMock.mockReset();
  updateMock.mockReset();
  settingsMock.mockResolvedValue(stored);
  secretsMock.mockReset();
  secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "environment" }));
  setSecretMock.mockReset();
  clearSecretMock.mockReset();
});

describe("IntegrationsPage", () => {
  it("shows Resend off, with its key from the environment", async () => {
    render(<IntegrationsPage />);

    expect(await screen.findByText("Wyłączona")).toBeTruthy();
    expect(await screen.findByText("Ze środowiska")).toBeTruthy();
    expect(screen.getByText("STELLARR_RESEND_API_KEY")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Wysyłaj pocztę przez Resend" }).getAttribute("aria-checked")).toBe("false");
  });

  it("turns Resend on by saving the settings with it chosen", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({ ...stored, resendEnabled: true, mailProvider: "resend" });
    render(<IntegrationsPage />);
    await screen.findByText("Wyłączona");

    settingsMock.mockResolvedValue({ ...stored, resendEnabled: true, mailProvider: "resend" });
    await user.click(screen.getByRole("switch", { name: "Wysyłaj pocztę przez Resend" }));

    expect(updateMock).toHaveBeenCalledWith({ ...stored, resendEnabled: true });
    expect(await screen.findByText("Poczta idzie teraz przez Resend.")).toBeTruthy();
    expect(screen.getByText("Aktywna")).toBeTruthy();
  });

  it("says why the change was not saved", async () => {
    const user = userEvent.setup();
    updateMock.mockRejectedValue(new Error("Adres nadawcy jest niepoprawny."));
    render(<IntegrationsPage />);
    await screen.findByText("Wyłączona");

    await user.click(screen.getByRole("switch", { name: "Wysyłaj pocztę przez Resend" }));

    expect(await screen.findByText("Adres nadawcy jest niepoprawny.")).toBeTruthy();
    expect(screen.getByText("Wyłączona")).toBeTruthy();
  });

  it("tells when the Resend key is missing", async () => {
    settingsMock.mockResolvedValue({ ...stored, resendApiKeyConfigured: false });
    secretsMock.mockResolvedValue(secrets());
    render(<IntegrationsPage />);

    expect(await screen.findByText("Nie ustawiony")).toBeTruthy();
    expect((screen.getByLabelText("Klucz API") as HTMLInputElement).placeholder).toBe("Wklej wartość");
  });

  it("sets the key from the panel, clears the field and reads the state again", async () => {
    const user = userEvent.setup();
    secretsMock.mockResolvedValue(secrets());
    render(<IntegrationsPage />);
    const field = (await screen.findByLabelText("Klucz API")) as HTMLInputElement;
    await screen.findByText("Nie ustawiony");

    setSecretMock.mockResolvedValue(secret("mail.resend-api-key", "panel"));
    secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "panel" }));
    await user.type(field, "re_from_panel");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(setSecretMock).toHaveBeenCalledWith("mail.resend-api-key", "re_from_panel");
    expect(await screen.findByText("Ustawiony tutaj")).toBeTruthy();
    expect(field.value).toBe("");
    expect(settingsMock).toHaveBeenCalledTimes(2);
  });

  it("removes a key set in the panel", async () => {
    const user = userEvent.setup();
    secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "panel" }));
    render(<IntegrationsPage />);
    await screen.findByText("Ustawiony tutaj");

    clearSecretMock.mockResolvedValue(secret("mail.resend-api-key", "environment"));
    secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "environment" }));
    await user.click(screen.getByRole("button", { name: "Usuń" }));

    expect(clearSecretMock).toHaveBeenCalledWith("mail.resend-api-key");
    expect(await screen.findByText("Ze środowiska")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Usuń" })).toBeNull();
  });

  it("says why a key was not saved", async () => {
    const user = userEvent.setup();
    secretsMock.mockResolvedValue(secrets());
    setSecretMock.mockRejectedValue(new Error("Wpisz wartość o długości najwyżej 4096 znaków."));
    render(<IntegrationsPage />);
    await screen.findByText("Nie ustawiony");

    await user.type(screen.getByLabelText("Klucz API"), "x");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Wpisz wartość o długości najwyżej 4096 znaków.");
  });
});
