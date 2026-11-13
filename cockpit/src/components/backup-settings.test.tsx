import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { BackupSettings } from "@/components/backup-settings";
import { CockpitApiError, cockpitApi, type CockpitBackupSettings, type CockpitSecret } from "@/lib/api";
import { selectPolish } from "@/test/locale";

selectPolish();
vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, cockpitApi: {
    ...original.cockpitApi, backupSettings: vi.fn(), updateBackupSettings: vi.fn(), resetBackupSettings: vi.fn(), secrets: vi.fn(),
  } };
});
const settings: CockpitBackupSettings = {
  enabled: true, intervalHours: 24, retryMinutes: 15, initialDelayMinutes: 5, retentionDays: 14,
  remoteEnabled: false, endpoint: "", region: "auto", bucket: "", prefix: "stellarr", cleanupEnabled: true, source: "environment",
};
const secrets: CockpitSecret[] = ["backups.access-key", "backups.secret-key"].map((name) => ({
  name: name as CockpitSecret["name"], configured: true, source: "panel", variable: "STELLARR_BACKUP_KEY", updatedAt: null,
}));
beforeEach(() => {
  vi.mocked(cockpitApi.backupSettings).mockReset().mockResolvedValue(settings);
  vi.mocked(cockpitApi.secrets).mockReset().mockResolvedValue(secrets);
  vi.mocked(cockpitApi.updateBackupSettings).mockReset().mockImplementation(async (value) => ({ ...value, source: "panel" }));
  vi.mocked(cockpitApi.resetBackupSettings).mockReset().mockResolvedValue(settings);
});

it("saves the complete policy and retention without sending credential placeholders", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(<BackupSettings onSaved={changed} />);
  const interval = await screen.findByLabelText("Częstotliwość (godziny)");
  await user.clear(interval);
  await user.type(interval, "12");
  await user.click(screen.getByRole("button", { name: "Zapisz konfigurację" }));
  await screen.findByText("Zapisano. Zmiany nie wymagają restartu.");
  expect(cockpitApi.updateBackupSettings).toHaveBeenCalledWith({ ...settings, intervalHours: 12 });
  expect(changed).toHaveBeenCalledOnce();
  expect((screen.getByLabelText("R2 Secret Access Key") as HTMLInputElement).value).toBe("");
  expect(screen.getByText("Obowiązują ustawienia zapisane w panelu.")).toBeTruthy();
});

it("keeps changes after a failed save and allows restoring deployment defaults", async () => {
  vi.mocked(cockpitApi.backupSettings).mockResolvedValue({ ...settings, source: "panel" });
  vi.mocked(cockpitApi.updateBackupSettings).mockRejectedValue(new CockpitApiError(400, "Validation failed", { destination: ["Nie udało się zapisać"] }));
  const user = userEvent.setup();
  render(<BackupSettings onSaved={vi.fn()} />);
  const interval = await screen.findByLabelText("Częstotliwość (godziny)");
  await user.clear(interval);
  await user.type(interval, "6");
  await user.click(screen.getByRole("button", { name: "Zapisz konfigurację" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Nie udało się zapisać");
  expect((interval as HTMLInputElement).value).toBe("6");
  await user.click(screen.getByRole("button", { name: "Przywróć domyślne ustawienia wdrożenia" }));
  await screen.findByText("Zapisano. Zmiany nie wymagają restartu.");
  expect((interval as HTMLInputElement).value).toBe("24");
  expect(cockpitApi.resetBackupSettings).toHaveBeenCalledOnce();
});

it("explains that retention is inactive when cleanup is disabled", async () => {
  vi.mocked(cockpitApi.backupSettings).mockResolvedValue({ ...settings, cleanupEnabled: false });
  render(<BackupSettings onSaved={vi.fn()} />);
  expect(within(await screen.findByRole("note")).getByText(/Automatyczne sprzątanie jest wyłączone/)).toBeTruthy();
});
