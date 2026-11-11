import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cockpitApi,
  type CockpitActivity,
  type CockpitActivityDay,
  type CockpitOverview,
  type CockpitRuntime,
} from "@/lib/api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardPage } from "@/pages/dashboard-page";
import { CockpitContext, type CockpitContextValue } from "@/state/cockpit-context";
import { selectPolish } from "@/test/locale";
import { cockpitValue } from "@/test/cockpit-fixtures";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, cockpitApi: { ...original.cockpitApi, activity: vi.fn(), runtime: vi.fn() } };
});

const activityMock = vi.mocked(cockpitApi.activity);
const runtimeMock = vi.mocked(cockpitApi.runtime);

/** A process up for a day and a bit, sampled three minutes running; the database failed the middle check. */
function runtime(): CockpitRuntime {
  const sample = (at: string, databaseUp: boolean) => ({
    at,
    workingSetBytes: 1,
    gcHeapBytes: 1,
    threads: 1,
    cpuPercent: 0,
    realtimeConnections: 0,
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    databaseUp,
    databaseLatencyMs: 0.5,
    storageUp: null,
  });
  return {
    startedAt: "2026-11-10T10:00:00Z",
    uptimeSeconds: 90061,
    workingSetBytes: 1,
    gcHeapBytes: 1,
    threadCount: 1,
    realtimeConnections: 0,
    voiceRooms: 0,
    databaseLatencyMs: 0.5,
    services: [],
    cpuPercent: 0,
    sampleSeconds: 30,
    history: [
      sample("2026-11-11T11:58:00Z", true),
      sample("2026-11-11T11:59:00Z", false),
      sample("2026-11-11T12:00:00Z", true),
    ],
  };
}
const fetchMock = vi.fn<typeof fetch>();

selectPolish();

type Counts = Partial<Record<Exclude<keyof CockpitActivityDay, "date">, number[]>>;

/** Thirty days ending on 11 November 2026, with the given counts on the last days of each series. */
function activity(counts: Counts = {}, activeUsers = 0): CockpitActivity {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 13 + index)).toISOString().slice(0, 10);
    const fromEnd = 29 - index;
    const on = (values: number[] = []) => values[values.length - 1 - fromEnd] ?? 0;
    return {
      date,
      messages: on(counts.messages),
      newMembers: on(counts.newMembers),
      activeUsers: on(counts.activeUsers),
      reactions: on(counts.reactions),
      uploads: on(counts.uploads),
      signIns: on(counts.signIns),
    };
  });
  return { timeZone: "Europe/Warsaw", days, activeUsers };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  activityMock.mockReset();
  activityMock.mockResolvedValue(activity());
  runtimeMock.mockReset();
  runtimeMock.mockResolvedValue(runtime());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers each health probe by path with an HTTP status. */
function answerProbes(live: number, ready: number) {
  const statuses: Record<string, number> = { "/health/live": live, "/health/ready": ready };
  fetchMock.mockImplementation(async (input) => new Response(null, { status: statuses[String(input)] ?? 404 }));
}

function sessionWith(overview: Partial<CockpitOverview>): CockpitContextValue {
  const value = cockpitValue();
  return { ...value, bootstrap: { ...value.bootstrap!, overview: { ...value.bootstrap!.overview, ...overview } } };
}

function renderDashboard(value: CockpitContextValue = cockpitValue()) {
  return render(
    <CockpitContext.Provider value={value}>
      <TooltipProvider>
        <DashboardPage />
      </TooltipProvider>
    </CockpitContext.Provider>,
  );
}

const counter = (title: string) => screen.getByRole("group", { name: title });
const service = (name: string) => screen.getByRole("group", { name });

describe("DashboardPage counters", () => {
  it("shows the overview's counters in the tiles", () => {
    answerProbes(200, 200);
    renderDashboard(
      sessionWith({
        userCount: 12345,
        onlineUserCount: 7,
        realtimeConnectionCount: 9,
        storedObjectBytes: 1536,
        messageCount: 987654,
        serverCount: 4,
        publicServerCount: 3,
      }),
    );

    expect(counter("Użytkownicy").textContent).toContain((12345).toLocaleString("pl-PL"));
    expect(counter("Użytkownicy").textContent).toContain("7 w sieci");
    expect(counter("Wiadomości").textContent).toContain((987654).toLocaleString("pl-PL"));
    expect(counter("Serwery").textContent).toBe("Serwery4publiczne: 3");
    expect(counter("Magazyn").textContent).toContain("1,5 KB");
  });

  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1,5 KB"],
    [10 * 1024 ** 2, "10 MB"],
    [Math.round(2.5 * 1024 ** 3), "2,5 GB"],
    [12345 * 1024 ** 3, `${(12345).toLocaleString("pl-PL")} GB`],
  ])("shows %d stored bytes as %s", (bytes, expected) => {
    answerProbes(200, 200);
    renderDashboard(sessionWith({ storedObjectBytes: bytes }));

    expect(counter("Magazyn").textContent).toContain(expected);
  });

  it("renders nothing until the session has a bootstrap", () => {
    answerProbes(200, 200);
    const { container } = renderDashboard(cockpitValue({ phase: "loading", bootstrap: null }));

    expect(container.textContent).toBe("");
  });
});

describe("DashboardPage health", () => {
  it("shows the state of each probe on its own row", async () => {
    answerProbes(200, 503);
    renderDashboard();

    expect(await within(service("API")).findByText("Działa")).toBeTruthy();
    expect(await within(service("SQLite")).findByText("Niedostępne")).toBeTruthy();
  });

  it("reports both services unavailable when the first probe cannot connect", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderDashboard();

    expect(await within(service("API")).findByText("Niedostępne")).toBeTruthy();
    expect(within(service("SQLite")).getByText("Niedostępne")).toBeTruthy();
  });

  it("shows checking until the probes answer", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderDashboard();

    expect(screen.getAllByText("Sprawdzanie")).toHaveLength(2);
  });

  it("aborts the first probe when the page goes away", () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const { unmount } = renderDashboard();
    const signals = fetchMock.mock.calls.map(([, init]) => init?.signal);

    unmount();

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
  });

  it("reads everything again when asked, keeping the last state on screen meanwhile", async () => {
    const user = userEvent.setup();
    answerProbes(200, 200);
    const value = cockpitValue();
    renderDashboard(value);
    await waitFor(() => expect(screen.getAllByText("Działa")).toHaveLength(2));

    let answerRecheck!: (response: Response) => void;
    fetchMock.mockReset();
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answerRecheck = resolve)));
    await user.click(screen.getByRole("button", { name: "Odśwież teraz" }));

    expect(value.reload).toHaveBeenCalledOnce();
    expect(activityMock).toHaveBeenCalledTimes(2);
    expect(runtimeMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/health/live", "/health/ready"]);
    expect(screen.getAllByText("Działa")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Odśwież teraz" }) as HTMLButtonElement).disabled).toBe(true);

    answerRecheck(new Response(null, { status: 503 }));

    await waitFor(() => expect(screen.getAllByText("Niedostępne")).toHaveLength(2));
    expect((screen.getByRole("button", { name: "Odśwież teraz" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when the state on screen was read", async () => {
    answerProbes(200, 200);
    renderDashboard();

    expect(await screen.findByText(/^Stan z \d{2}:\d{2}:\d{2}$/)).toBeTruthy();
  });
});

describe("DashboardPage refreshing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("reads the state again every 30 seconds and the activity every 5 minutes", async () => {
    answerProbes(200, 200);
    const value = cockpitValue();
    renderDashboard(value);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(value.reload).toHaveBeenCalledOnce();
    expect(runtimeMock).toHaveBeenCalledTimes(2);
    expect(activityMock).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9 * 30_000);
    });

    expect(runtimeMock).toHaveBeenCalledTimes(11);
    expect(activityMock).toHaveBeenCalledTimes(2);
  });

  it("skips the refresh while the tab is hidden", async () => {
    answerProbes(200, 200);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const value = cockpitValue();
    renderDashboard(value);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(value.reload).not.toHaveBeenCalled();
    expect(runtimeMock).toHaveBeenCalledOnce();
  });

  it("stops refreshing when the page goes away", async () => {
    answerProbes(200, 200);
    const { unmount } = renderDashboard();
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(runtimeMock).toHaveBeenCalledOnce();
  });
});

describe("DashboardPage activity", () => {
  const chart = () => screen.getByRole("table", { name: "Aktywność dzień po dniu" });
  const valueOn = (day: string) =>
    within(chart()).getByRole("rowheader", { name: new RegExp(day) }).nextElementSibling?.textContent;

  it("charts the messages of the last thirty days in the instance's time zone", async () => {
    answerProbes(200, 200);
    activityMock.mockResolvedValue(activity({ messages: [4, 12], newMembers: [1, 0] }));
    renderDashboard();

    expect(await screen.findByText("Ostatnie 30 dni, Europe/Warsaw")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Wiadomości/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(chart()).getAllByRole("row")).toHaveLength(31);
    expect(valueOn("11 listopada")).toBe("12");
    expect(valueOn("10 listopada")).toBe("4");
    expect(screen.getByRole("img", { name: "Wiadomości" })).toBeTruthy();
  });

  it("puts each series' total for the thirty days on its tab", async () => {
    answerProbes(200, 200);
    activityMock.mockResolvedValue(
      activity({ messages: [4, 12], activeUsers: [2, 3], reactions: [5], uploads: [1, 1], signIns: [7, 0, 2] }, 4),
    );
    renderDashboard();

    const tab = async (name: string) => (await screen.findByRole("tab", { name: new RegExp(name) })).textContent;
    expect(await tab("Wiadomości")).toBe("Wiadomości16");
    // People count once over the window, not once per day they wrote.
    expect(await tab("Aktywni użytkownicy")).toBe("Aktywni użytkownicy4");
    expect(await tab("Nowi użytkownicy")).toBe("Nowi użytkownicy0");
    expect(await tab("Reakcje")).toBe("Reakcje5");
    expect(await tab("Przesłane pliki")).toBe("Przesłane pliki2");
    expect(await tab("Logowania")).toBe("Logowania9");
  });

  it("switches the chart to new users", async () => {
    const user = userEvent.setup();
    answerProbes(200, 200);
    activityMock.mockResolvedValue(activity({ messages: [4, 12], newMembers: [3, 0] }));
    renderDashboard();
    await screen.findByRole("img", { name: "Wiadomości" });

    await user.click(screen.getByRole("tab", { name: /Nowi użytkownicy/ }));

    expect(screen.getByRole("tab", { name: /Nowi użytkownicy/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Osoby, które dołączyły do serwera instancji.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Nowi użytkownicy" })).toBeTruthy();
    expect(valueOn("10 listopada")).toBe("3");
    expect(valueOn("11 listopada")).toBe("0");
  });

  it("shows the exact value of the day picked with the keyboard", async () => {
    const user = userEvent.setup();
    answerProbes(200, 200);
    activityMock.mockResolvedValue(activity({ messages: [4, 12] }));
    renderDashboard();
    const plot = await screen.findByRole("img", { name: "Wiadomości" });

    plot.focus();
    expect((await screen.findByRole("status")).textContent).toContain("12");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status").textContent).toContain("4");
    expect(screen.getByRole("status").textContent).toContain("10 listopada");
  });

  it("says so when the activity cannot be read", async () => {
    answerProbes(200, 200);
    activityMock.mockRejectedValue(new Error("Brak połączenia"));
    renderDashboard();

    expect((await screen.findByRole("alert")).textContent).toBe("Brak połączenia");
  });
});

describe("DashboardPage availability", () => {
  it("shows how long the process has run and the share of each service's last hour", async () => {
    answerProbes(200, 200);
    renderDashboard();

    expect(await screen.findByText("1 d 1 h 1 min")).toBeTruthy();
    expect(within(service("API")).getByText("100%")).toBeTruthy();
    expect(within(service("SQLite")).getByText(`${(66.7).toLocaleString("pl-PL")}%`)).toBeTruthy();
    expect(await screen.findByText("Wszystko działa")).toBeTruthy();
  });

  it("says when a service is down now", async () => {
    answerProbes(200, 503);
    renderDashboard();

    expect(await screen.findByText("Coś nie działa")).toBeTruthy();
  });

  it("says there is no data before the first sample", async () => {
    answerProbes(200, 200);
    runtimeMock.mockResolvedValue({ ...runtime(), history: [] });
    renderDashboard();

    await screen.findByText("1 d 1 h 1 min");
    expect(within(service("API")).getByText("brak danych")).toBeTruthy();
  });
});
