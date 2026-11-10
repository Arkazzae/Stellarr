import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { opsApi, type OpsBackup, type OpsBackups } from "@/lib/api";
import { BackupsPage } from "@/pages/backups-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    opsApi: { ...original.opsApi, backups: vi.fn(), createBackup: vi.fn(), verifyBackup: vi.fn() },
  };
});

const backupsMock = vi.mocked(opsApi.backups);
const createMock = vi.mocked(opsApi.createBackup);
const verifyMock = vi.mocked(opsApi.verifyBackup);

const formatTime = (value: string) => new Date(value).toLocaleString("pl-PL");

const newest: OpsBackup = {
  id: "backup-2.db",
  sizeBytes: 5 * 1024 * 1024 + 512 * 1024,
  createdAt: "2025-03-04T10:00:00Z",
  verifiedAt: null,
};
const older: OpsBackup = {
  id: "backup-1.db",
  sizeBytes: 3 * 1024 * 1024,
  createdAt: "2025-03-01T10:00:00Z",
  verifiedAt: "2025-03-02T12:30:00Z",
};

function list(backups: OpsBackup[], retentionDays = 14): OpsBackups {
  return { backups, retentionDays };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderLoaded(backups: OpsBackups = list([newest, older])) {
  backupsMock.mockResolvedValueOnce(backups);
  render(<BackupsPage />);
  // The retention only shows a number once the list has been read.
  await screen.findByRole("group", { name: /^Kopii · retencja \d+ dni$/ });
}

const summary = (label: string) => within(screen.getByRole("group", { name: label }));
const rowOf = (id: string) => screen.getByRole("row", { name: new RegExp(id.replace(".", "\\.")) });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  backupsMock.mockReset();
  createMock.mockReset();
  verifyMock.mockReset();
});

describe("BackupsPage list", () => {
  it("lists each backup with its time, size and verification", async () => {
    await renderLoaded();

    const unverified = rowOf("backup-2.db");
    expect(within(unverified).getByText(formatTime(newest.createdAt))).toBeTruthy();
    expect(unverified.textContent).toMatch(/5,5\sMB/);
    expect(within(unverified).getByText("Niesprawdzony")).toBeTruthy();
    const verified = rowOf("backup-1.db");
    expect(verified.textContent).toMatch(/3\sMB/);
    expect(within(verified).getByText(formatTime(older.verifiedAt!))).toBeTruthy();
    expect(within(verified).queryByText("Niesprawdzony")).toBeNull();
  });

  it("links each backup to its download", async () => {
    await renderLoaded();

    const link = screen.getByRole("link", { name: "Pobierz backup-1.db" });

    expect(link.getAttribute("href")).toBe("/api/ops/backups/backup-1.db/download");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("summarises the newest backup, the newest verified one and the retention", async () => {
    await renderLoaded(list([newest, older], 30));

    expect(summary("Ostatni backup").getByText(formatTime(newest.createdAt))).toBeTruthy();
    expect(summary("Ostatnia weryfikacja").getByText(formatTime(older.verifiedAt!))).toBeTruthy();
    const count = screen.getByRole("group", { name: "Kopii · retencja 30 dni" });
    expect(count.textContent).toContain("2");
  });

  it("shows placeholders and an empty row when there are no backups", async () => {
    await renderLoaded(list([], 7));

    expect(screen.getByText("Nie utworzono jeszcze żadnej kopii.")).toBeTruthy();
    expect(summary("Ostatni backup").getByText("Brak")).toBeTruthy();
    expect(summary("Ostatnia weryfikacja").getByText("Brak")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Kopii · retencja 7 dni" }).textContent).toContain("0");
  });

  it("does not claim the list is empty before it has loaded", () => {
    backupsMock.mockReturnValue(new Promise(() => {}));
    render(<BackupsPage />);

    expect(screen.queryByText("Nie utworzono jeszcze żadnej kopii.")).toBeNull();
    expect(screen.getByRole("group", { name: "Kopii · retencja — dni" })).toBeTruthy();
  });

  it("shows the reason when the list cannot be read", async () => {
    backupsMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(<BackupsPage />);

    expect(await screen.findByText("Błąd backupu")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
  });

  it("explains a list failure that carries no message", async () => {
    backupsMock.mockRejectedValue("boom");
    render(<BackupsPage />);

    expect(await screen.findByText("Nie udało się pobrać backupów.")).toBeTruthy();
  });
});

describe("BackupsPage create", () => {
  it("creates a backup, reads the list again and names the new backup", async () => {
    const user = userEvent.setup();
    await renderLoaded(list([older]));
    const creation = deferred<OpsBackup>();
    createMock.mockReturnValue(creation.promise);
    backupsMock.mockResolvedValueOnce(list([newest, older]));

    await user.click(button("Utwórz backup"));

    expect(createMock).toHaveBeenCalledOnce();
    expect(button("Tworzenie").disabled).toBe(true);

    creation.resolve(newest);

    expect(await screen.findByText("Utworzono backup-2.db.")).toBeTruthy();
    expect(screen.getByText("Gotowe")).toBeTruthy();
    expect(backupsMock).toHaveBeenCalledTimes(2);
    expect(rowOf("backup-2.db")).toBeTruthy();
    expect(button("Utwórz backup").disabled).toBe(false);
  });

  it("shows why a backup could not be created", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockRejectedValue(new Error("Brak miejsca na dysku."));

    await user.click(button("Utwórz backup"));

    expect(await screen.findByText("Brak miejsca na dysku.")).toBeTruthy();
    expect(screen.queryByText("Gotowe")).toBeNull();
    expect(backupsMock).toHaveBeenCalledOnce();
    expect(button("Utwórz backup").disabled).toBe(false);
  });

  it("explains a creation failure that carries no message", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockRejectedValue("boom");

    await user.click(button("Utwórz backup"));

    expect(await screen.findByText("Nie udało się utworzyć backupu.")).toBeTruthy();
  });

  it("still names the new backup when the list cannot be read again", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockResolvedValue(newest);
    backupsMock.mockRejectedValueOnce(new Error("Backend odpowiedział kodem 500."));

    await user.click(button("Utwórz backup"));

    expect(await screen.findByText("Utworzono backup-2.db.")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
  });
});

describe("BackupsPage verify", () => {
  it("verifies one backup, reads the list again and shows the new verification", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const check = deferred<OpsBackup>();
    verifyMock.mockReturnValue(check.promise);
    const verifiedAt = "2025-03-05T08:00:00Z";
    backupsMock.mockResolvedValueOnce(list([{ ...newest, verifiedAt }, older]));

    await user.click(within(rowOf("backup-2.db")).getByRole("button", { name: "Sprawdź" }));

    expect(verifyMock).toHaveBeenCalledExactlyOnceWith("backup-2.db");
    expect((within(rowOf("backup-2.db")).getByRole("button", { name: "Sprawdź" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rowOf("backup-1.db")).getByRole("button", { name: "Sprawdź" }) as HTMLButtonElement).disabled).toBe(false);

    check.resolve({ ...newest, verifiedAt });

    expect(await screen.findByText("Kontrola integralności backup-2.db zakończona powodzeniem.")).toBeTruthy();
    expect(backupsMock).toHaveBeenCalledTimes(2);
    expect(within(rowOf("backup-2.db")).getByText(formatTime(verifiedAt))).toBeTruthy();
    expect((within(rowOf("backup-2.db")).getByRole("button", { name: "Sprawdź" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows why a backup failed verification", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    verifyMock.mockRejectedValue(new Error("integrity_check: database disk image is malformed"));

    await user.click(within(rowOf("backup-1.db")).getByRole("button", { name: "Sprawdź" }));

    expect(await screen.findByText("integrity_check: database disk image is malformed")).toBeTruthy();
    expect(screen.queryByText("Gotowe")).toBeNull();
    expect(backupsMock).toHaveBeenCalledOnce();
  });

  it("explains a verification failure that carries no message", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    verifyMock.mockRejectedValue("boom");

    await user.click(within(rowOf("backup-1.db")).getByRole("button", { name: "Sprawdź" }));

    expect(await screen.findByText("Backup nie przeszedł weryfikacji.")).toBeTruthy();
  });

  it("keeps the last notice on screen when a later action fails", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockResolvedValue(newest);
    backupsMock.mockResolvedValueOnce(list([newest, older]));
    await user.click(button("Utwórz backup"));
    await screen.findByText("Utworzono backup-2.db.");

    verifyMock.mockRejectedValue(new Error("Plik kopii zniknął."));
    await user.click(within(rowOf("backup-1.db")).getByRole("button", { name: "Sprawdź" }));

    expect(await screen.findByText("Plik kopii zniknął.")).toBeTruthy();
    expect(screen.getByText("Utworzono backup-2.db.")).toBeTruthy();
  });

  it("replaces the notice and drops the error when the next action succeeds", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockResolvedValue(newest);
    backupsMock.mockResolvedValueOnce(list([newest, older]));
    await user.click(button("Utwórz backup"));
    await screen.findByText("Utworzono backup-2.db.");
    verifyMock.mockRejectedValue(new Error("Plik kopii zniknął."));
    await user.click(within(rowOf("backup-1.db")).getByRole("button", { name: "Sprawdź" }));
    await screen.findByText("Plik kopii zniknął.");

    verifyMock.mockResolvedValue(older);
    backupsMock.mockResolvedValueOnce(list([newest, older]));
    await user.click(within(rowOf("backup-1.db")).getByRole("button", { name: "Sprawdź" }));

    expect(await screen.findByText("Kontrola integralności backup-1.db zakończona powodzeniem.")).toBeTruthy();
    expect(screen.queryByText("Plik kopii zniknął.")).toBeNull();
    expect(screen.queryByText("Utworzono backup-2.db.")).toBeNull();
  });
});
