import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CockpitApiError, cockpitApi, type CockpitCloudflareR2Settings, type CockpitSettings } from "@/lib/api";
import { IntegrationsPage } from "@/pages/integrations-page";
import { selectPolish } from "@/test/locale";
import { secret, secrets } from "@/test/secrets";

selectPolish();
// Radix switches measure themselves with a ResizeObserver, which jsdom lacks.
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

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
      testGiphy: vi.fn(),
      cloudflareR2: vi.fn(),
      updateCloudflareR2: vi.fn(),
      resetCloudflareR2: vi.fn(),
    },
  };
});

const settingsMock = vi.mocked(cockpitApi.settings);
const updateMock = vi.mocked(cockpitApi.updateSettings);
const secretsMock = vi.mocked(cockpitApi.secrets);
const setSecretMock = vi.mocked(cockpitApi.setSecret);
const clearSecretMock = vi.mocked(cockpitApi.clearSecret);
const testGiphyMock = vi.mocked(cockpitApi.testGiphy);
const cloudflareMock = vi.mocked(cockpitApi.cloudflareR2);
const updateCloudflareMock = vi.mocked(cockpitApi.updateCloudflareR2);

const cloudflare: CockpitCloudflareR2Settings = {
  enabled: false, endpoint: "", region: "auto", bucket: "", prefix: "stellarr", source: "environment",
};

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
  giphyEnabled: false,
  giphyKeyConfigured: false,
  inviteMailEnabled: true,
  recoveryMailEnabled: true,
  alertMailEnabled: false,
  backupRetentionDays: 14,
  logRetentionDays: 30,
  orphanObjectRetentionDays: 7,
  automaticCleanupEnabled: true,
  updatedAt: "2025-03-01T10:00:00Z",
  mfaRequirement: "optional",
  trustedDeviceDays: 14,
  authChallengeMinutes: 5,
  emailCodeMinutes: 8,
  emailCodeCooldownSeconds: 45,
  emailCodeMaxAttempts: 5,
  emailCodeSendsPerHour: 10,
  cliRecoveryMinutes: 10,
};

beforeEach(() => {
  settingsMock.mockReset();
  updateMock.mockReset();
  settingsMock.mockResolvedValue(stored);
  secretsMock.mockReset();
  secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "environment" }));
  setSecretMock.mockReset();
  clearSecretMock.mockReset();
  testGiphyMock.mockReset();
  cloudflareMock.mockReset();
  cloudflareMock.mockResolvedValue(cloudflare);
  updateCloudflareMock.mockReset();
  vi.mocked(cockpitApi.resetCloudflareR2).mockReset();
});

describe("IntegrationsPage", () => {
  /** The Resend card, once the page has loaded; the GIPHY card has the same labels. */
  const resend = async () => within((await screen.findByText("Resend")).closest("[data-slot=card]") as HTMLElement);

  it("shows Resend off, with its key from the environment", async () => {
    render(<IntegrationsPage />);

    const card = await resend();
    expect(card.getByText("Wyłączona")).toBeTruthy();
    expect(await card.findByText("Ze środowiska")).toBeTruthy();
    expect(card.getByText("STELLARR_RESEND_API_KEY")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Wysyłaj pocztę przez Resend" }).getAttribute("aria-checked")).toBe("false");
  });

  it("turns Resend on by saving the settings with it chosen", async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({ ...stored, resendEnabled: true, mailProvider: "resend" });
    render(<IntegrationsPage />);
    const card = await resend();

    settingsMock.mockResolvedValue({ ...stored, resendEnabled: true, mailProvider: "resend" });
    await user.click(screen.getByRole("switch", { name: "Wysyłaj pocztę przez Resend" }));

    expect(updateMock).toHaveBeenCalledWith(stored, { resendEnabled: true });
    expect(await screen.findByText("Poczta idzie teraz przez Resend.")).toBeTruthy();
    expect(card.getByText("Aktywna")).toBeTruthy();
  });

  it("says why the change was not saved", async () => {
    const user = userEvent.setup();
    updateMock.mockRejectedValue(new Error("Adres nadawcy jest niepoprawny."));
    render(<IntegrationsPage />);
    const card = await resend();

    await user.click(screen.getByRole("switch", { name: "Wysyłaj pocztę przez Resend" }));

    expect(await screen.findByText("Adres nadawcy jest niepoprawny.")).toBeTruthy();
    expect(card.getByText("Wyłączona")).toBeTruthy();
  });

  it("tells when the Resend key is missing", async () => {
    settingsMock.mockResolvedValue({ ...stored, resendApiKeyConfigured: false });
    secretsMock.mockResolvedValue(secrets());
    render(<IntegrationsPage />);

    const card = await resend();
    expect(await card.findByText("Nie ustawiony")).toBeTruthy();
    expect((card.getByLabelText("Klucz API") as HTMLInputElement).placeholder).toBe("Wklej wartość");
  });

  it("sets the key from the panel, clears the field and reads the state again", async () => {
    const user = userEvent.setup();
    secretsMock.mockResolvedValue(secrets());
    render(<IntegrationsPage />);
    const card = await resend();
    const field = card.getByLabelText("Klucz API") as HTMLInputElement;
    await card.findByText("Nie ustawiony");

    setSecretMock.mockResolvedValue(secret("mail.resend-api-key", "panel"));
    secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "panel" }));
    await user.type(field, "re_from_panel");
    await user.click(card.getByRole("button", { name: "Zapisz" }));

    expect(setSecretMock).toHaveBeenCalledWith("mail.resend-api-key", "re_from_panel");
    expect(await card.findByText("Ustawiony tutaj")).toBeTruthy();
    expect(field.value).toBe("");
    expect(settingsMock).toHaveBeenCalledTimes(2);
  });

  it("removes a key set in the panel", async () => {
    const user = userEvent.setup();
    secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "panel" }));
    render(<IntegrationsPage />);
    const card = await resend();
    await card.findByText("Ustawiony tutaj");

    clearSecretMock.mockResolvedValue(secret("mail.resend-api-key", "environment"));
    secretsMock.mockResolvedValue(secrets({ "mail.resend-api-key": "environment" }));
    await user.click(card.getByRole("button", { name: "Usuń" }));

    expect(clearSecretMock).toHaveBeenCalledWith("mail.resend-api-key");
    expect(await card.findByText("Ze środowiska")).toBeTruthy();
    expect(card.queryByRole("button", { name: "Usuń" })).toBeNull();
  });

  it("says why a key was not saved", async () => {
    const user = userEvent.setup();
    secretsMock.mockResolvedValue(secrets());
    setSecretMock.mockRejectedValue(new Error("Wpisz wartość o długości najwyżej 4096 znaków."));
    render(<IntegrationsPage />);
    const card = await resend();
    await card.findByText("Nie ustawiony");

    await user.type(card.getByLabelText("Klucz API"), "x");
    await user.click(card.getByRole("button", { name: "Zapisz" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Wpisz wartość o długości najwyżej 4096 znaków.");
  });
});

describe("IntegrationsPage GIPHY", () => {
  const giphyCard = () => screen.getByText("GIPHY").closest("[data-slot=card]") as HTMLElement;
  const giphySwitch = () => screen.getByRole("switch", { name: "Pokazuj GIF-y w kliencie web" });

  it("waits for a key before GIFs can be switched on or checked", async () => {
    secretsMock.mockResolvedValue(secrets());
    render(<IntegrationsPage />);
    await screen.findByText("GIPHY");

    expect(giphySwitch().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Najpierw ustaw klucz API.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sprawdź połączenie" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches GIFs on by saving the settings with them chosen", async () => {
    const user = userEvent.setup();
    const withKey = { ...stored, giphyKeyConfigured: true };
    settingsMock.mockResolvedValue(withKey);
    updateMock.mockResolvedValue({ ...withKey, giphyEnabled: true });
    render(<IntegrationsPage />);
    await screen.findByText("GIPHY");

    settingsMock.mockResolvedValue({ ...withKey, giphyEnabled: true });
    await user.click(giphySwitch());

    expect(updateMock).toHaveBeenCalledWith(withKey, { giphyEnabled: true });
    expect(await screen.findByText("Klient web pokazuje teraz GIF-y.")).toBeTruthy();
    expect(giphySwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("says when GIPHY accepts the key", async () => {
    const user = userEvent.setup();
    settingsMock.mockResolvedValue({ ...stored, giphyKeyConfigured: true });
    testGiphyMock.mockResolvedValue({ connected: true });
    render(<IntegrationsPage />);
    await screen.findByText("GIPHY");

    await user.click(screen.getByRole("button", { name: "Sprawdź połączenie" }));

    expect(testGiphyMock).toHaveBeenCalledOnce();
    expect(giphyCard().textContent).toContain("GIPHY przyjęło klucz.");
  });

  it("says what GIPHY answered when it refuses the key", async () => {
    const user = userEvent.setup();
    settingsMock.mockResolvedValue({ ...stored, giphyKeyConfigured: true });
    testGiphyMock.mockRejectedValue(new CockpitApiError(502, "GIPHY odrzuciło klucz (HTTP 403)."));
    render(<IntegrationsPage />);
    await screen.findByText("GIPHY");

    await user.click(screen.getByRole("button", { name: "Sprawdź połączenie" }));

    expect((await screen.findByRole("alert")).textContent).toBe("GIPHY odrzuciło klucz (HTTP 403).");
  });
});

describe("IntegrationsPage Cloudflare R2", () => {
  it("keeps the offsite connection on the integrations page and saves it there", async () => {
    const user = userEvent.setup();
    updateCloudflareMock.mockImplementation(async (value) => ({ ...value, source: "panel" }));
    render(<IntegrationsPage />);

    const card = (await screen.findByText("Cloudflare R2")).closest("[data-slot=card]") as HTMLElement;
    await user.type(within(card).getByLabelText("Nazwa bucketu"), "private-backups");
    await user.click(within(card).getByRole("button", { name: "Zapisz połączenie" }));

    expect(updateCloudflareMock).toHaveBeenCalledWith({ ...cloudflare, bucket: "private-backups" });
    expect(await within(card).findByText("Zapisano. Następna wysyłka kopii użyje tego połączenia.")).toBeTruthy();
  });
});
