import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitLogEntry, type CockpitLogs } from "@/lib/api";
import { LogsPage } from "@/pages/logs-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, cockpitApi: { ...original.cockpitApi, logs: vi.fn() } };
});

const logsMock = vi.mocked(cockpitApi.logs);

const formatTime = (value: string) => new Date(value).toLocaleString("pl-PL");

function logsFixture(): CockpitLogs {
  return {
    logs: [
      { at: "2025-03-04T10:00:00Z", level: "error", source: "Stellarr.Mail", message: "Wysyłka nieudana", traceId: "trace-aaa" },
      { at: "2025-03-04T09:00:00Z", level: "warn", source: "Stellarr.Storage", message: "Mało miejsca na dysku", traceId: "trace-bbb" },
      { at: "2025-03-04T08:00:00Z", level: "info", source: "Stellarr.Hosting", message: "Start w Łodzi", traceId: "" },
    ],
    audit: [
      { id: "a-1", actor: "Ola Owner", summary: "Zmieniono nazwę instancji", at: "2025-03-04T11:00:00Z" },
      { id: "a-2", actor: "Jan Łoś", summary: "Wyłączono konto użytkownika", at: "2025-03-04T07:00:00Z" },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function renderLoaded(logs: CockpitLogs = logsFixture()) {
  logsMock.mockResolvedValue(logs);
  render(<LogsPage />);
  await screen.findByRole("tab", { name: /^Logi/ });
}

const search = () => screen.getByPlaceholderText("Szukaj");
const levelSelect = () => screen.getByRole("combobox", { name: "Poziom logów" });
const logsTab = (count: number) => screen.getByRole("tab", { name: `Logi (${count})` });
const auditTab = (count: number) => screen.getByRole("tab", { name: `Audyt (${count})` });

beforeEach(() => {
  logsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LogsPage loading", () => {
  it("shows a status line until the first read finishes", async () => {
    const read = deferred<CockpitLogs>();
    logsMock.mockReturnValue(read.promise);
    render(<LogsPage />);

    expect(screen.getByRole("status").textContent).toBe("Wczytywanie");
    expect(screen.queryByRole("tab")).toBeNull();

    read.resolve(logsFixture());

    await screen.findByRole("tab", { name: "Logi (3)" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the reason when the read fails", async () => {
    logsMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(<LogsPage />);

    expect(await screen.findByText("Błąd logów")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(screen.getByText("Brak logów pasujących do filtrów.")).toBeTruthy();
  });

  it("explains a failure that carries no message", async () => {
    logsMock.mockRejectedValue("boom");
    render(<LogsPage />);

    expect(await screen.findByText("Nie udało się pobrać logów.")).toBeTruthy();
  });

  it("reads again on refresh", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const next = logsFixture();
    next.logs = [{ at: "2025-03-05T10:00:00Z", level: "info", source: "Stellarr.New", message: "Nowy wpis", traceId: "" }];
    logsMock.mockResolvedValue(next);

    await user.click(screen.getByRole("button", { name: "Odśwież" }));

    expect(await screen.findByText("Nowy wpis")).toBeTruthy();
    expect(logsTab(1)).toBeTruthy();
    expect(logsMock).toHaveBeenCalledTimes(2);
  });

  it("links the export to the TSV download", async () => {
    await renderLoaded();

    const link = screen.getByRole("link", { name: "Eksportuj TSV" });

    expect(link.getAttribute("href")).toBe(cockpitApi.logExportUrl);
    expect(link.hasAttribute("download")).toBe(true);
  });
});

describe("LogsPage entries", () => {
  it("lists the logs with time, level, source, message and trace", async () => {
    await renderLoaded();

    const row = screen.getByRole("row", { name: /Wysyłka nieudana/ });
    expect(within(row).getByText(formatTime("2025-03-04T10:00:00Z"))).toBeTruthy();
    expect(within(row).getByText("Błąd")).toBeTruthy();
    expect(within(row).getByText("Stellarr.Mail")).toBeTruthy();
    expect(within(row).getByText("trace-aaa")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Mało miejsca/ })).getByText("Ostrzeżenie")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Start w Łodzi/ })).getByText("Informacja")).toBeTruthy();
  });

  it("marks a log without a trace id with a dash", async () => {
    await renderLoaded();

    expect(within(screen.getByRole("row", { name: /Start w Łodzi/ })).getByText("—")).toBeTruthy();
  });

  it("lists the audit trail on its own tab", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    expect(screen.queryByText("Zmieniono nazwę instancji")).toBeNull();

    await user.click(auditTab(2));

    const row = screen.getByRole("row", { name: /Zmieniono nazwę instancji/ });
    expect(within(row).getByText("Ola Owner")).toBeTruthy();
    expect(within(row).getByText(formatTime("2025-03-04T11:00:00Z"))).toBeTruthy();
    expect(screen.getByText("Wyłączono konto użytkownika")).toBeTruthy();
  });

  it("tells logs that share a timestamp apart", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const entry: CockpitLogEntry = { at: "2025-03-04T10:00:00Z", level: "info", source: "Stellarr.Hosting", message: "Ten sam czas", traceId: "" };
    await renderLoaded({ logs: [entry, { ...entry, message: "Ten sam czas, drugi wpis" }], audit: [] });

    expect(screen.getAllByRole("row", { name: /Ten sam czas/ })).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });

  it("says when there is nothing to show", async () => {
    const user = userEvent.setup();
    await renderLoaded({ logs: [], audit: [] });

    expect(screen.getByText("Brak logów pasujących do filtrów.")).toBeTruthy();
    await user.click(auditTab(0));
    expect(screen.getByText("Brak wpisów audytowych.")).toBeTruthy();
  });
});

describe("LogsPage filters", () => {
  it.each([
    ["the message", "dysku", "Mało miejsca na dysku"],
    ["the source", "stellarr.mail", "Wysyłka nieudana"],
    ["the trace id", "TRACE-BBB", "Mało miejsca na dysku"],
  ])("finds a log by %s regardless of case", async (_field, text, expected) => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(search(), text);

    expect(logsTab(1)).toBeTruthy();
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("compares case with the Polish locale", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(search(), "ŁODZI");

    expect(screen.getByText("Start w Łodzi")).toBeTruthy();
    expect(logsTab(1)).toBeTruthy();
  });

  it("ignores spaces around the query", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(search(), "  wysyłka  ");

    expect(logsTab(1)).toBeTruthy();
  });

  it("filters the audit trail by actor and summary with the same search box", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(search(), "łoś");
    expect(auditTab(1)).toBeTruthy();

    await user.clear(search());
    await user.type(search(), "nazwę instancji");
    expect(auditTab(1)).toBeTruthy();

    await user.click(auditTab(1));
    expect(screen.getByText("Zmieniono nazwę instancji")).toBeTruthy();
    expect(screen.queryByText("Wyłączono konto użytkownika")).toBeNull();
  });

  it("does not match audit entries against the log fields", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(search(), "stellarr.mail");

    expect(logsTab(1)).toBeTruthy();
    expect(auditTab(0)).toBeTruthy();
  });

  it("shows the empty rows when nothing matches", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(search(), "brak takiego wpisu");

    expect(logsTab(0)).toBeTruthy();
    expect(screen.getByText("Brak logów pasujących do filtrów.")).toBeTruthy();
    await user.click(auditTab(0));
    expect(screen.getByText("Brak wpisów audytowych.")).toBeTruthy();
  });

  it.each([
    ["warn", "Mało miejsca na dysku"],
    ["error", "Wysyłka nieudana"],
    ["info", "Start w Łodzi"],
  ])("shows only %s logs when that level is chosen", async (level, expected) => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(levelSelect(), level);

    expect(logsTab(1)).toBeTruthy();
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("leaves the audit trail alone when a level is chosen", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(levelSelect(), "error");

    expect(auditTab(2)).toBeTruthy();
  });

  it("combines the level with the search", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(levelSelect(), "warn");
    await user.type(search(), "wysyłka");

    expect(logsTab(0)).toBeTruthy();

    await user.selectOptions(levelSelect(), "all");
    await waitFor(() => expect(logsTab(1)).toBeTruthy());
  });
});
