import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { CloudflareSettings } from "@/components/cloudflare-settings";
import { CockpitApiError, cockpitApi, type CockpitCloudflareR2Settings } from "@/lib/api";
import { selectPolish } from "@/test/locale";
import { secrets } from "@/test/secrets";

selectPolish();
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, cockpitApi: {
    ...original.cockpitApi, cloudflareR2: vi.fn(), updateCloudflareR2: vi.fn(), resetCloudflareR2: vi.fn(),
  } };
});

const settings: CockpitCloudflareR2Settings = {
  enabled: false, mode: "s3", endpoint: "", region: "auto", bucket: "", prefix: "stellarr", source: "environment",
};

beforeEach(() => {
  vi.mocked(cockpitApi.cloudflareR2).mockReset().mockResolvedValue(settings);
  vi.mocked(cockpitApi.updateCloudflareR2).mockReset().mockImplementation(async (value) => ({ ...value, source: "panel" }));
  vi.mocked(cockpitApi.resetCloudflareR2).mockReset().mockResolvedValue(settings);
});

const card = async () => within((await screen.findByText("Cloudflare R2")).closest(".ui-card") as HTMLElement);

it("saves the connection and keeps both credentials out of the request", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(<CloudflareSettings secrets={secrets({ "cloudflare.r2.access-key": "environment" })} onSecretChanged={changed} />);
  const cloudflare = await card();
  await user.type(cloudflare.getByLabelText("Adres API S3 (HTTPS)"), "https://account.r2.cloudflarestorage.com");
  await user.type(cloudflare.getByLabelText("Nazwa bucketu"), "private-backups");
  await user.click(cloudflare.getByRole("button", { name: "Zapisz połączenie" }));

  await cloudflare.findByText("Zapisano. Następna wysyłka kopii użyje tego połączenia.");
  expect(cockpitApi.updateCloudflareR2).toHaveBeenCalledWith({
    ...settings,
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "private-backups",
  });
  expect((cloudflare.getByLabelText("R2 Secret Access Key") as HTMLInputElement).value).toBe("");
  expect(changed).not.toHaveBeenCalled();
});

it("asks for both credentials before offsite copies can be enabled", async () => {
  const user = userEvent.setup();
  vi.mocked(cockpitApi.updateCloudflareR2).mockRejectedValue(new CockpitApiError(400, "Validation failed", {
    destination: ["Cloudflare R2 wymaga HTTPS, nazwy bucketu, regionu, bezpiecznego prefiksu i obu poświadczeń."],
  }));
  render(<CloudflareSettings secrets={secrets()} onSecretChanged={vi.fn()} />);
  const cloudflare = await card();

  await user.click(cloudflare.getByRole("switch", { name: "Wysyłaj kopie do Cloudflare R2" }));
  await user.type(cloudflare.getByLabelText("Adres API S3 (HTTPS)"), "https://account.r2.cloudflarestorage.com");
  await user.type(cloudflare.getByLabelText("Nazwa bucketu"), "private-backups");
  await user.click(cloudflare.getByRole("button", { name: "Zapisz połączenie" }));

  expect((await cloudflare.findByRole("alert")).textContent).toContain("obu poświadczeń");
});


it("switches to the relay Worker and asks for its token instead of S3 keys", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(<CloudflareSettings secrets={secrets({ "cloudflare.r2.worker-token": "environment" })} onSecretChanged={changed} />);
  const cloudflare = await card();

  await user.selectOptions(cloudflare.getByLabelText("Połączenie"), "worker");

  expect(cloudflare.queryByLabelText("R2 Access Key ID")).toBeNull();
  expect(cloudflare.queryByLabelText("R2 Secret Access Key")).toBeNull();
  expect(cloudflare.getByLabelText("Token wysyłki Workera")).toBeTruthy();
  await user.type(cloudflare.getByLabelText("Adres Workera (HTTPS)"), "https://relay.example.workers.dev");
  await user.click(cloudflare.getByRole("switch", { name: "Wysyłaj kopie do Cloudflare R2" }));
  await user.click(cloudflare.getByRole("button", { name: "Zapisz połączenie" }));

  expect(cockpitApi.updateCloudflareR2).toHaveBeenCalledWith({
    ...settings,
    mode: "worker",
    endpoint: "https://relay.example.workers.dev",
    enabled: true,
  });
  expect(await cloudflare.findByText("Zapisano. Następna wysyłka kopii użyje tego połączenia.")).toBeTruthy();
});

it("restores deployment defaults from the panel", async () => {
  const user = userEvent.setup();
  vi.mocked(cockpitApi.cloudflareR2).mockResolvedValue({ ...settings, source: "panel", bucket: "private-backups" });
  const reset = vi.fn().mockResolvedValue(settings);
  vi.mocked(cockpitApi.resetCloudflareR2).mockImplementation(reset);
  render(<CloudflareSettings secrets={secrets()} onSecretChanged={vi.fn()} />);
  const cloudflare = await card();

  await user.click(cloudflare.getByRole("button", { name: "Przywróć domyślne ustawienia wdrożenia" }));

  expect(reset).toHaveBeenCalledOnce();
  await cloudflare.findByText("Zapisano. Następna wysyłka kopii użyje tego połączenia.");
});
