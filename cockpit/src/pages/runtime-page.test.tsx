import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitRuntime, type CockpitRuntimeSample } from "@/lib/api";
import { RuntimePage } from "@/pages/runtime-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  cockpitApi: { runtime: vi.fn() },
}));

const runtimeMock = vi.mocked(cockpitApi.runtime);

const MEGABYTE = 1024 * 1024;

function sample(
  at: string,
  counts: Pick<CockpitRuntimeSample, "requests" | "clientErrors" | "serverErrors">,
  checks: Partial<Pick<CockpitRuntimeSample, "databaseUp" | "storageUp">> = {},
): CockpitRuntimeSample {
  return {
    at,
    workingSetBytes: 500 * MEGABYTE,
    gcHeapBytes: 12 * MEGABYTE,
    threads: 30,
    cpuPercent: 10,
    realtimeConnections: 3,
    databaseUp: true,
    databaseLatencyMs: 0.4,
    storageUp: null,
    ...counts,
    ...checks,
  };
}

function runtimeWith(overrides: Partial<CockpitRuntime> = {}): CockpitRuntime {
  return {
    startedAt: "2025-03-04T10:15:00Z",
    uptimeSeconds: 90061,
    workingSetBytes: 512 * MEGABYTE,
    gcHeapBytes: 12.5 * MEGABYTE,
    threadCount: 31,
    realtimeConnections: 4,
    voiceRooms: 2,
    databaseLatencyMs: 1.5,
    cpuPercent: 12.5,
    sampleSeconds: 30,
    history: [
      sample("2025-03-05T11:15:00Z", { requests: 40, clientErrors: 3, serverErrors: 1 }),
      sample("2025-03-05T11:15:30Z", { requests: 60, clientErrors: 2, serverErrors: 4 }),
    ],
    services: [
      { name: "SQLite", state: "healthy", detail: "Zapytanie testowe wykonane", id: "database" },
      { name: "Magazyn obiektów", state: "warning", detail: "Magazyn obiektów nie odpowiedział", id: "storage" },
    ],
    ...overrides,
  };
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

const metric = (label: string) => screen.getByRole("group", { name: label }).textContent ?? "";

beforeEach(() => {
  runtimeMock.mockReset();
});

describe("RuntimePage", () => {
  it("shows a status line until the first read finishes", async () => {
    const read = deferred<CockpitRuntime>();
    runtimeMock.mockReturnValue(read.promise);
    render(<RuntimePage />);

    expect(screen.getByRole("status").textContent).toBe("Wczytywanie metryk");

    read.resolve(runtimeWith());

    await screen.findByRole("group", { name: "Pamięć procesu" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the six figures of the process", async () => {
    runtimeMock.mockResolvedValue(runtimeWith());
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Pamięć procesu" });

    expect(metric("Żądania")).toContain("100");
    expect(metric("Żądania")).toContain("w ostatniej godzinie");
    expect(metric("Błędy serwera")).toContain("5");
    expect(metric("Błędy serwera")).toContain("błędy klienta (4xx): 5");
    expect(metric("CPU")).toContain("12,5%");
    expect(metric("Pamięć procesu")).toMatch(/512MB/);
    expect(metric("Pamięć procesu")).toMatch(/sterta 12,5\sMB, wątki: 31/);
    expect(metric("Połączenia")).toContain("4");
    expect(metric("Połączenia")).toContain("realtime, pokoje głosowe: 2");
    expect(metric("Opóźnienie SQLite")).toContain("1,5ms");
  });

  it("draws the requests of the last hour, with their values in a table", async () => {
    runtimeMock.mockResolvedValue(runtimeWith());
    render(<RuntimePage />);

    expect(await screen.findByRole("img", { name: "Żądania do API" })).toBeTruthy();
    const requests = screen.getByRole("table", { name: "Żądania do API co 30 sekund" });
    expect(within(requests).getAllByRole("row")).toHaveLength(3);
    expect(within(requests).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["39", "1", "56", "4"]);
  });

  it.each([
    [59, "0 min"],
    [3600 * 5 + 60 * 7, "5 h 7 min"],
    [86400 * 3 + 60 * 2, "3 d 2 min"],
    [86400 * 2 + 3600 * 4 + 60 * 30 + 59, "2 d 4 h 30 min"],
  ])("writes an uptime of %d seconds as %s", async (seconds, expected) => {
    runtimeMock.mockResolvedValue(runtimeWith({ uptimeSeconds: seconds }));
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Pamięć procesu" });

    expect(
      screen.getByText(
        `Proces działa od ${expected}, uruchomiony ${new Date("2025-03-04T10:15:00Z").toLocaleString("pl-PL")}.`,
      ),
    ).toBeTruthy();
  });

  it("shows each service with its state, its detail and its share of the last hour", async () => {
    runtimeMock.mockResolvedValue(runtimeWith());
    render(<RuntimePage />);

    const sqlite = await screen.findByRole("group", { name: "SQLite" });
    expect(within(sqlite).getByText("Działa")).toBeTruthy();
    expect(within(sqlite).getByText("Zapytanie testowe wykonane")).toBeTruthy();
    expect(within(sqlite).getByText("100%")).toBeTruthy();
    const storage = screen.getByRole("group", { name: "Magazyn obiektów" });
    expect(within(storage).getByText("Wymaga uwagi")).toBeTruthy();
    expect(within(storage).getByText("Magazyn obiektów nie odpowiedział")).toBeTruthy();
    // No sample checked the store, so there is nothing to show yet rather than a made-up 100%.
    expect(within(storage).getByText("brak danych")).toBeTruthy();
  });

  it("draws a service's last hour from the checks its samples took", async () => {
    runtimeMock.mockResolvedValue(
      runtimeWith({
        history: [
          sample("2025-03-05T11:14:00Z", { requests: 1, clientErrors: 0, serverErrors: 0 }, { storageUp: true }),
          sample("2025-03-05T11:15:00Z", { requests: 1, clientErrors: 0, serverErrors: 0 }, { storageUp: false, databaseUp: false }),
        ],
      }),
    );
    render(<RuntimePage />);

    const storage = await screen.findByRole("group", { name: "Magazyn obiektów" });
    expect(within(storage).getByText("50%")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "SQLite" })).getByText("50%")).toBeTruthy();
  });

  it("shows the reason when the first read fails", async () => {
    runtimeMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(<RuntimePage />);

    expect(await screen.findByText("Błąd runtime")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains a failure that carries no message", async () => {
    runtimeMock.mockRejectedValue("boom");
    render(<RuntimePage />);

    expect(await screen.findByText("Nie udało się pobrać metryk runtime.")).toBeTruthy();
  });

  it("reads again on refresh and shows the new values while it waits", async () => {
    const user = userEvent.setup();
    runtimeMock.mockResolvedValueOnce(runtimeWith({ threadCount: 31 }));
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Pamięć procesu" });

    const second = deferred<CockpitRuntime>();
    runtimeMock.mockReturnValueOnce(second.promise);
    await user.click(screen.getByRole("button", { name: "Odśwież dane" }));

    expect((screen.getByRole("button", { name: "Odśwież dane" }) as HTMLButtonElement).disabled).toBe(true);
    expect(metric("Pamięć procesu")).toContain("wątki: 31");

    second.resolve(runtimeWith({ threadCount: 44 }));

    await waitFor(() => expect(metric("Pamięć procesu")).toContain("wątki: 44"));
    expect(runtimeMock).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: "Odśwież dane" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the last metrics next to the error when a refresh fails", async () => {
    const user = userEvent.setup();
    runtimeMock.mockResolvedValueOnce(runtimeWith({ threadCount: 31 }));
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Pamięć procesu" });

    runtimeMock.mockRejectedValueOnce(new Error("Nie udało się połączyć z backendem Stellarr."));
    await user.click(screen.getByRole("button", { name: "Odśwież dane" }));

    expect(await screen.findByText("Nie udało się połączyć z backendem Stellarr.")).toBeTruthy();
    expect(metric("Pamięć procesu")).toContain("wątki: 31");
  });

  it("clears the error once a refresh succeeds", async () => {
    const user = userEvent.setup();
    runtimeMock.mockRejectedValueOnce(new Error("Backend odpowiedział kodem 500."));
    render(<RuntimePage />);
    await screen.findByText("Błąd runtime");

    runtimeMock.mockResolvedValueOnce(runtimeWith());
    await user.click(screen.getByRole("button", { name: "Odśwież dane" }));

    await screen.findByRole("group", { name: "Pamięć procesu" });
    expect(screen.queryByText("Błąd runtime")).toBeNull();
  });
});
