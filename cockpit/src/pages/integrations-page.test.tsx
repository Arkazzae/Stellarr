import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitSettings } from "@/lib/api";
import { IntegrationsPage } from "@/pages/integrations-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: { ...original.cockpitApi, settings: vi.fn(), updateSettings: vi.fn() },
  };
});

const settingsMock = vi.mocked(cockpitApi.settings);
const updateMock = vi.mocked(cockpitApi.updateSettings);

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
});

describe("IntegrationsPage", () => {
  it("shows Resend off, with its key configured", async () => {
    render(<IntegrationsPage />);

    expect(await screen.findByText("Wyłączona")).toBeTruthy();
    expect(screen.getByText("Skonfigurowany")).toBeTruthy();
    expect(screen.getByText("Mail__ResendApiKey")).toBeTruthy();
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
    render(<IntegrationsPage />);

    expect(await screen.findByText("Brak sekretu")).toBeTruthy();
  });
});
