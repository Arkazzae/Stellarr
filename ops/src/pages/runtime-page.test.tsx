import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { opsApi, type OpsRuntime } from "@/lib/api";
import { RuntimePage } from "@/pages/runtime-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  opsApi: { runtime: vi.fn() },
}));

const runtimeMock = vi.mocked(opsApi.runtime);

const MEGABYTE = 1024 * 1024;

function runtimeWith(overrides: Partial<OpsRuntime> = {}): OpsRuntime {
  return {
    startedAt: "2025-03-04T10:15:00Z",
    uptimeSeconds: 90061,
    workingSetBytes: 512 * MEGABYTE,
    gcHeapBytes: 12.5 * MEGABYTE,
    threadCount: 31,
    realtimeConnections: 4,
    voiceRooms: 2,
    databaseLatencyMs: 1.5,
    services: [
      { name: "SQLite", state: "healthy", detail: "Zapytanie testowe wykonane" },
      { name: "Poczta", state: "warning", detail: "Brak klucza API" },
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
    const read = deferred<OpsRuntime>();
    runtimeMock.mockReturnValue(read.promise);
    render(<RuntimePage />);

    expect(screen.getByRole("status").textContent).toBe("Wczytywanie metryk");

    read.resolve(runtimeWith());

    await screen.findByRole("group", { name: "Czas działania" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the eight metrics of the process", async () => {
    runtimeMock.mockResolvedValue(runtimeWith());
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Czas działania" });

    expect(metric("Czas działania")).toContain("1 d 1 h 1 min");
    expect(metric("Pamięć procesu")).toMatch(/512\sMB/);
    expect(metric("Sterta GC")).toMatch(/12,5\sMB/);
    expect(metric("Wątki procesu")).toContain("31");
    expect(metric("Połączenia realtime")).toContain("4");
    expect(metric("Aktywne pokoje głosowe")).toContain("2");
    expect(metric("Opóźnienie SQLite")).toContain("1,5 ms");
    expect(metric("Start procesu")).toContain(new Date("2025-03-04T10:15:00Z").toLocaleString("pl-PL"));
  });

  it.each([
    [59, "0 min"],
    [3600 * 5 + 60 * 7, "5 h 7 min"],
    [86400 * 3 + 60 * 2, "3 d 2 min"],
    [86400 * 2 + 3600 * 4 + 60 * 30 + 59, "2 d 4 h 30 min"],
  ])("writes an uptime of %d seconds as %s", async (seconds, expected) => {
    runtimeMock.mockResolvedValue(runtimeWith({ uptimeSeconds: seconds }));
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Czas działania" });

    expect(metric("Czas działania")).toBe(`Czas działania${expected}`);
  });

  it("lists each service with its status and details", async () => {
    runtimeMock.mockResolvedValue(runtimeWith());
    render(<RuntimePage />);

    const sqlite = await screen.findByRole("row", { name: /SQLite/ });
    expect(within(sqlite).getByText("Działa")).toBeTruthy();
    expect(within(sqlite).getByText("Zapytanie testowe wykonane")).toBeTruthy();
    const mail = screen.getByRole("row", { name: /Poczta/ });
    expect(within(mail).getByText("Wymaga uwagi")).toBeTruthy();
    expect(within(mail).getByText("Brak klucza API")).toBeTruthy();
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
    await screen.findByRole("group", { name: "Wątki procesu" });

    const second = deferred<OpsRuntime>();
    runtimeMock.mockReturnValueOnce(second.promise);
    await user.click(screen.getByRole("button", { name: "Odśwież dane" }));

    expect((screen.getByRole("button", { name: "Odśwież dane" }) as HTMLButtonElement).disabled).toBe(true);
    expect(metric("Wątki procesu")).toContain("31");

    second.resolve(runtimeWith({ threadCount: 44 }));

    await waitFor(() => expect(metric("Wątki procesu")).toContain("44"));
    expect(runtimeMock).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: "Odśwież dane" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the last metrics next to the error when a refresh fails", async () => {
    const user = userEvent.setup();
    runtimeMock.mockResolvedValueOnce(runtimeWith({ threadCount: 31 }));
    render(<RuntimePage />);
    await screen.findByRole("group", { name: "Wątki procesu" });

    runtimeMock.mockRejectedValueOnce(new Error("Nie udało się połączyć z backendem Stellarr."));
    await user.click(screen.getByRole("button", { name: "Odśwież dane" }));

    expect(await screen.findByText("Nie udało się połączyć z backendem Stellarr.")).toBeTruthy();
    expect(metric("Wątki procesu")).toContain("31");
  });

  it("clears the error once a refresh succeeds", async () => {
    const user = userEvent.setup();
    runtimeMock.mockRejectedValueOnce(new Error("Backend odpowiedział kodem 500."));
    render(<RuntimePage />);
    await screen.findByText("Błąd runtime");

    runtimeMock.mockResolvedValueOnce(runtimeWith());
    await user.click(screen.getByRole("button", { name: "Odśwież dane" }));

    await screen.findByRole("group", { name: "Czas działania" });
    expect(screen.queryByText("Błąd runtime")).toBeNull();
  });
});
