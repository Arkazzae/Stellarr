import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitActivity, type CockpitOverview, type CockpitRuntime } from "@/lib/api";
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

/** Thirty days ending on 11 November 2026, with the given counts on the last days. */
function activity(messages: number[] = [], newMembers: number[] = []): CockpitActivity {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 13 + index)).toISOString().slice(0, 10);
    const fromEnd = 29 - index;
    return {
      date,
      messages: messages[messages.length - 1 - fromEnd] ?? 0,
      newMembers: newMembers[newMembers.length - 1 - fromEnd] ?? 0,
    };
  });
  return { timeZone: "Europe/Warsaw", days };
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
      <DashboardPage />
    </CockpitContext.Provider>,
  );
}

const counter = (title: string) => screen.getByRole("group", { name: title });
const service = (name: string) => screen.getByRole("group", { name });
const uptimeCard = () => screen.getByText("Dostępność").closest("[data-slot=card]") as HTMLElement;

describe("DashboardPage counters", () => {
  it("shows the overview's counters in the cards and the services table", () => {
    answerProbes(200, 200);
    renderDashboard(
      sessionWith({
        userCount: 12345,
        onlineUserCount: 7,
        realtimeConnectionCount: 9,
        storedObjectBytes: 1536,
        messageCount: 987654,
      }),
    );

    expect(counter("Użytkownicy").textContent).toContain((12345).toLocaleString("pl-PL"));
    expect(counter("Użytkownicy").textContent).toContain("7 w sieci");
    expect(counter("Wiadomości").textContent).toContain((987654).toLocaleString("pl-PL"));
    expect(uptimeCard().textContent).toContain("Realtime9");
    expect(uptimeCard().textContent).toContain("Obiekty1,5 KB");
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

    expect(uptimeCard().textContent).toContain(expected);
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
    expect(await within(service("Baza danych")).findByText("Niedostępne")).toBeTruthy();
  });

  it("reports both services unavailable when the first probe cannot connect", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderDashboard();

    expect(await within(service("API")).findByText("Niedostępne")).toBeTruthy();
    expect(within(service("Baza danych")).getByText("Niedostępne")).toBeTruthy();
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

  it("probes again together with reloading the session when asked to check again", async () => {
    const user = userEvent.setup();
    answerProbes(200, 200);
    const value = cockpitValue();
    renderDashboard(value);
    await waitFor(() => expect(screen.getAllByText("Działa")).toHaveLength(2));

    let answerRecheck!: (response: Response) => void;
    fetchMock.mockReset();
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answerRecheck = resolve)));
    await user.click(screen.getByRole("button", { name: "Sprawdź ponownie" }));

    expect(value.reload).toHaveBeenCalledOnce();
    expect(activityMock).toHaveBeenCalledTimes(2);
    expect(runtimeMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/health/live", "/health/ready"]);
    expect(screen.getAllByText("Sprawdzanie")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Sprawdź ponownie" }) as HTMLButtonElement).disabled).toBe(true);

    answerRecheck(new Response(null, { status: 503 }));

    await waitFor(() => expect(screen.getAllByText("Niedostępne")).toHaveLength(2));
    expect((screen.getByRole("button", { name: "Sprawdź ponownie" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("DashboardPage activity", () => {
  const chart = () => screen.getByRole("table", { name: "Aktywność dzień po dniu" });
  const valueOn = (day: string) =>
    within(chart()).getByRole("rowheader", { name: new RegExp(day) }).nextElementSibling?.textContent;

  it("charts the messages of the last thirty days in the instance's time zone", async () => {
    answerProbes(200, 200);
    activityMock.mockResolvedValue(activity([4, 12], [1, 0]));
    renderDashboard();

    expect(await screen.findByText("Ostatnie 30 dni, strefa czasowa Europe/Warsaw.")).toBeTruthy();
    expect(within(chart()).getAllByRole("row")).toHaveLength(31);
    expect(valueOn("11 listopada")).toBe("12");
    expect(valueOn("10 listopada")).toBe("4");
    expect(screen.getByRole("img", { name: "Wiadomości" })).toBeTruthy();
  });

  it("switches the chart to new users", async () => {
    const user = userEvent.setup();
    answerProbes(200, 200);
    activityMock.mockResolvedValue(activity([4, 12], [3, 0]));
    renderDashboard();
    await screen.findByRole("img", { name: "Wiadomości" });

    await user.click(screen.getByRole("button", { name: "Nowi użytkownicy" }));

    expect(screen.getByRole("button", { name: "Nowi użytkownicy" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Nowi użytkownicy" })).toBeTruthy();
    expect(valueOn("10 listopada")).toBe("3");
    expect(valueOn("11 listopada")).toBe("0");
  });

  it("shows the exact value of the day picked with the keyboard", async () => {
    const user = userEvent.setup();
    answerProbes(200, 200);
    activityMock.mockResolvedValue(activity([4, 12]));
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
    expect(within(service("API")).getByText("100% w ostatniej godzinie")).toBeTruthy();
    expect(within(service("Baza danych")).getByText(`${(66.7).toLocaleString("pl-PL")}% w ostatniej godzinie`)).toBeTruthy();
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
