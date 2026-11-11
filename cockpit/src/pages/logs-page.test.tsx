import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitLogEntry, type CockpitLogFilters, type CockpitLogs } from "@/lib/api";
import { LogsPage } from "@/pages/logs-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, cockpitApi: { ...original.cockpitApi, logs: vi.fn() } };
});

const logsMock = vi.mocked(cockpitApi.logs);

function entry(sequence: number, overrides: Partial<CockpitLogEntry> = {}): CockpitLogEntry {
  return {
    sequence,
    at: "2026-11-11T10:15:30Z",
    level: "info",
    source: "Stellarr.Api.Endpoints",
    message: `wpis ${sequence}`,
    traceId: `trace-${sequence}`,
    ...overrides,
  };
}

function page(entries: CockpitLogEntry[], nextBefore: number | null = null): CockpitLogs {
  return {
    entries,
    nextBefore,
    levels: { info: 7, warn: 2, error: 1 },
    sources: [
      { name: "Stellarr.Api.Endpoints", count: 8 },
      { name: "Microsoft.AspNetCore", count: 2 },
    ],
    capacity: 10000,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

const lastFilters = (): CockpitLogFilters => logsMock.mock.lastCall![0];
const messages = () => screen.getAllByRole("button", { expanded: false }).map((button) => button.textContent);

beforeEach(() => {
  logsMock.mockReset();
  logsMock.mockResolvedValue(page([entry(3), entry(2, { level: "warn" }), entry(1, { level: "error" })]));
});

describe("LogsPage", () => {
  it("shows a status line until the first page arrives", async () => {
    const first = deferred<CockpitLogs>();
    logsMock.mockReturnValueOnce(first.promise);
    render(<LogsPage />);

    expect(screen.getByRole("status").textContent).toBe("Wczytywanie");

    first.resolve(page([entry(1)]));
    expect(await screen.findByText("wpis 1")).toBeTruthy();
  });

  it("lists the newest lines with time, level, source and message, and no audit", async () => {
    render(<LogsPage />);

    const row = (await screen.findByText("wpis 2")).closest("tr")!;
    expect(within(row).getByText("Ostrzeżenie")).toBeTruthy();
    expect(within(row).getByText("Stellarr.Api.Endpoints")).toBeTruthy();
    expect(messages()).toEqual(["wpis 3", "wpis 2", "wpis 1"]);
    expect(screen.queryByText(/Audyt/)).toBeNull();
    expect(logsMock).toHaveBeenCalledWith({ levels: [], source: "", search: "" }, null, expect.any(AbortSignal));
  });

  it("opens a line to show its time, source and trace in full", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);

    await user.click(await screen.findByRole("button", { name: "wpis 3" }));

    const opened = screen.getByRole("button", { expanded: true });
    expect(opened.textContent).toBe("wpis 3");
    expect(screen.getByText("trace-3")).toBeTruthy();
  });

  it("searches once the typing settles", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText("wpis 3");

    await user.type(screen.getByRole("searchbox", { name: "Szukaj w treści, źródle i trace" }), "disk");

    await waitFor(() => expect(lastFilters().search).toBe("disk"));
    expect(logsMock.mock.calls.filter(([filters]) => filters.search !== "").length).toBe(1);
  });

  it("filters by levels, shows their counts and clears every filter", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText("wpis 3");

    const errors = screen.getByRole("button", { name: /Błędy/ });
    expect(errors.textContent).toBe("Błędy1");
    await user.click(errors);
    await user.click(screen.getByRole("button", { name: /Ostrzeżenia/ }));

    expect(errors.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(lastFilters().levels).toEqual(["error", "warn"]));

    await user.click(screen.getByRole("button", { name: "Wyczyść filtry" }));
    await waitFor(() => expect(lastFilters()).toEqual({ levels: [], source: "", search: "" }));
    expect(screen.queryByRole("button", { name: "Wyczyść filtry" })).toBeNull();
  });

  it("filters by a source from the list", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText("wpis 3");

    await user.selectOptions(screen.getByLabelText("Źródło logów"), "Microsoft.AspNetCore");

    await waitFor(() => expect(lastFilters().source).toBe("Microsoft.AspNetCore"));
  });

  it("loads older lines from the cursor and appends them", async () => {
    const user = userEvent.setup();
    logsMock.mockResolvedValueOnce(page([entry(9), entry(8)], 8));
    logsMock.mockResolvedValueOnce(page([entry(5), entry(4)], null));
    render(<LogsPage />);
    await screen.findByText("wpis 9");

    await user.click(screen.getByRole("button", { name: "Wczytaj starsze" }));

    expect(await screen.findByText("wpis 4")).toBeTruthy();
    expect(logsMock.mock.lastCall![1]).toBe(8);
    expect(messages()).toEqual(["wpis 9", "wpis 8", "wpis 5", "wpis 4"]);
    expect(screen.queryByRole("button", { name: "Wczytaj starsze" })).toBeNull();
    expect(screen.getByText("To wszystkie pasujące wpisy spośród 10 000 najnowszych w pamięci.")).toBeTruthy();
  });

  it("reads the first page again on refresh", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText("wpis 3");

    logsMock.mockResolvedValueOnce(page([entry(4)]));
    await user.click(screen.getByRole("button", { name: "Odśwież" }));

    expect(await screen.findByText("wpis 4")).toBeTruthy();
    expect(logsMock.mock.lastCall![1]).toBeNull();
  });

  it("links the export to the lines the filters keep", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);
    await screen.findByText("wpis 3");

    await user.click(screen.getByRole("button", { name: /Błędy/ }));

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Eksportuj TSV" }).getAttribute("href")).toBe(
        "/api/cockpit/logs/export?level=error",
      ),
    );
  });

  it("shows the reason when the logs cannot be read", async () => {
    logsMock.mockReset();
    logsMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(<LogsPage />);

    expect(await screen.findByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(screen.getByText("Brak logów pasujących do filtrów.")).toBeTruthy();
  });
});
