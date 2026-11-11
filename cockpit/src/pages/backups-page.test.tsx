import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitBackup, type CockpitBackupJob, type CockpitBackups } from "@/lib/api";
import { BackupsPage } from "@/pages/backups-page";
import { CockpitContext } from "@/state/cockpit-context";
import { cockpitValue } from "@/test/cockpit-fixtures";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: { ...original.cockpitApi, backups: vi.fn(), createBackup: vi.fn(), verifyBackup: vi.fn() },
  };
});

const backupsMock = vi.mocked(cockpitApi.backups);
const createMock = vi.mocked(cockpitApi.createBackup);
const verifyMock = vi.mocked(cockpitApi.verifyBackup);

const formatTime = (value: string) => new Date(value).toLocaleString("pl-PL");

const newest: CockpitBackup = {
  id: "backup-2.db",
  sizeBytes: 5 * 1024 * 1024 + 512 * 1024,
  createdAt: "2025-03-04T10:00:00Z",
  verifiedAt: null,
  parts: ["database"],
  missingObjects: 0,
};
const older: CockpitBackup = {
  id: "backup-1.db",
  sizeBytes: 3 * 1024 * 1024,
  createdAt: "2025-03-01T10:00:00Z",
  verifiedAt: "2025-03-02T12:30:00Z",
  parts: ["database"],
  missingObjects: 0,
};
const archive: CockpitBackup = {
  id: "backup-3.zip",
  sizeBytes: 40 * 1024 * 1024,
  createdAt: "2025-03-05T10:00:00Z",
  verifiedAt: null,
  parts: ["database", "objects", "keys"],
  missingObjects: 2,
};
const job: CockpitBackupJob = {
  id: "backup-3.zip",
  parts: ["database", "objects", "keys"],
  startedAt: "2025-03-05T09:59:00Z",
  phase: "objects",
  objectsDone: 3,
  objectsTotal: 10,
};

function list(backups: CockpitBackup[], retentionDays = 14, extra: Partial<CockpitBackups> = {}): CockpitBackups {
  return { backups, retentionDays, job: null, lastFailure: null, ...extra };
}

function renderPage() {
  return render(
    <CockpitContext.Provider value={cockpitValue()}>
      <BackupsPage />
    </CockpitContext.Provider>,
  );
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

async function renderLoaded(backups: CockpitBackups = list([newest, older])) {
  backupsMock.mockResolvedValueOnce(backups);
  renderPage();
  // The retention only shows a number once the list has been read.
  await screen.findByRole("group", { name: /^Kopii · retencja \d+ dni$/ });
}

const summary = (label: string) => within(screen.getByRole("group", { name: label }));
const rowOf = (id: string) => screen.getByRole("row", { name: new RegExp(id.replace(".", "\\.")) });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const dialog = () => within(screen.getByRole("dialog"));

/** Opens the dialog and creates a backup of whatever is chosen in it. */
async function createThroughDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("Utwórz kopię"));
  await user.click(dialog().getByRole("button", { name: "Utwórz kopię" }));
}

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

    expect(link.getAttribute("href")).toBe("/api/cockpit/backups/backup-1.db/download");
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
    renderPage();

    expect(screen.queryByText("Nie utworzono jeszcze żadnej kopii.")).toBeNull();
    expect(screen.getByRole("group", { name: "Kopii · retencja — dni" })).toBeTruthy();
  });

  it("shows the reason when the list cannot be read", async () => {
    backupsMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    renderPage();

    expect(await screen.findByText("Błąd backupu")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
  });

  it("explains a list failure that carries no message", async () => {
    backupsMock.mockRejectedValue("boom");
    renderPage();

    expect(await screen.findByText("Nie udało się pobrać backupów.")).toBeTruthy();
  });
});

describe("BackupsPage create", () => {
  it("creates a backup, reads the list again and names the new backup", async () => {
    const user = userEvent.setup();
    await renderLoaded(list([older]));
    const creation = deferred<CockpitBackup>();
    createMock.mockReturnValue(creation.promise);
    backupsMock.mockResolvedValueOnce(list([newest, older]));

    await createThroughDialog(user);

    expect(createMock).toHaveBeenCalledExactlyOnceWith({ database: true, objects: true, keys: true, instance: true });
    expect((dialog().getByRole("button", { name: "Utwórz kopię" }) as HTMLButtonElement).disabled).toBe(true);

    creation.resolve(newest);

    expect(await screen.findByText("Utworzono backup-2.db.")).toBeTruthy();
    expect(screen.getByText("Gotowe")).toBeTruthy();
    expect(backupsMock).toHaveBeenCalledTimes(2);
    expect(rowOf("backup-2.db")).toBeTruthy();
    expect(button("Utwórz kopię").disabled).toBe(false);
  });

  it("shows why a backup could not be created", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockRejectedValue(new Error("Brak miejsca na dysku."));

    await createThroughDialog(user);

    expect(await screen.findByText("Brak miejsca na dysku.")).toBeTruthy();
    expect(screen.queryByText("Gotowe")).toBeNull();
    expect(backupsMock).toHaveBeenCalledOnce();
    expect(button("Utwórz kopię").disabled).toBe(false);
  });

  it("explains a creation failure that carries no message", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockRejectedValue("boom");

    await createThroughDialog(user);

    expect(await screen.findByText("Nie udało się utworzyć backupu.")).toBeTruthy();
  });

  it("still names the new backup when the list cannot be read again", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockResolvedValue(newest);
    backupsMock.mockRejectedValueOnce(new Error("Backend odpowiedział kodem 500."));

    await createThroughDialog(user);

    expect(await screen.findByText("Utworzono backup-2.db.")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
  });
});

describe("BackupsPage verify", () => {
  it("verifies one backup, reads the list again and shows the new verification", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const check = deferred<CockpitBackup>();
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
    await createThroughDialog(user);
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
    await createThroughDialog(user);
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

describe("BackupsPage contents and archives", () => {
  it("says what each backup holds and how many files it is missing", async () => {
    await renderLoaded(list([archive, newest]));

    const full = rowOf("backup-3.zip");
    expect(within(full).getByText("Baza danych")).toBeTruthy();
    expect(within(full).getByText("Pliki z magazynu")).toBeTruthy();
    expect(within(full).getByText("Klucze")).toBeTruthy();
    expect(within(full).getByText("brak plików: 2")).toBeTruthy();
    expect(within(rowOf("backup-2.db")).queryByText("Pliki z magazynu")).toBeNull();
  });

  it("leaves out what is unticked and refuses a backup of nothing", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    createMock.mockResolvedValue(newest);
    backupsMock.mockResolvedValueOnce(list([newest, older]));

    await user.click(button("Utwórz kopię"));
    for (const part of ["Baza danych", "Pliki z magazynu", "Klucze", "Pliki instancji"]) {
      await user.click(dialog().getByRole("checkbox", { name: new RegExp(part) }));
    }
    expect(dialog().getByRole("alert").textContent).toBe("Wybierz co najmniej jedną część.");
    expect((dialog().getByRole("button", { name: "Utwórz kopię" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(dialog().getByRole("checkbox", { name: /Baza danych/ }));
    await user.click(dialog().getByRole("button", { name: "Utwórz kopię" }));

    expect(createMock).toHaveBeenCalledExactlyOnceWith({ database: true, objects: false, keys: false, instance: false });
    expect(await screen.findByText("Utworzono backup-2.db.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("follows an archive while it is written and says when it is ready", async () => {
    const user = userEvent.setup();
    await renderLoaded(list([older]));
    createMock.mockResolvedValue(job);
    backupsMock.mockResolvedValueOnce(list([older], 14, { job }));
    backupsMock.mockResolvedValue(list([archive, older]));

    await createThroughDialog(user);

    expect(await screen.findByText("3 z 10 plików")).toBeTruthy();
    expect(screen.getByText("Tworzenie kopii: Pliki z magazynu")).toBeTruthy();
    expect(button("Utwórz kopię").disabled).toBe(true);
    expect(await screen.findByText("Utworzono backup-3.zip.", {}, { timeout: 4000 })).toBeTruthy();
    expect(rowOf("backup-3.zip")).toBeTruthy();
    expect(screen.queryByText("3 z 10 plików")).toBeNull();
  });

  it("says why the last archive did not finish", async () => {
    await renderLoaded(
      list([older], 14, {
        lastFailure: { id: "backup-3.zip", message: "Na dysku brakuje miejsca na kopię.", at: "2025-03-05T10:00:00Z" },
      }),
    );

    expect(screen.getByText("Kopia backup-3.zip się nie udała")).toBeTruthy();
    expect(screen.getByText("Na dysku brakuje miejsca na kopię.")).toBeTruthy();
  });
});
