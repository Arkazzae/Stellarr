import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { opsApi, type OpsActivity, type OpsOverview } from "@/lib/api";
import { DashboardPage } from "@/pages/dashboard-page";
import { OpsContext, type OpsContextValue } from "@/state/ops-context";
import { selectPolish } from "@/test/locale";
import { opsValue } from "@/test/ops-fixtures";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, opsApi: { ...original.opsApi, activity: vi.fn() } };
});

const activityMock = vi.mocked(opsApi.activity);
const fetchMock = vi.fn<typeof fetch>();

selectPolish();

/** Thirty days ending on 11 November 2026, with the given counts on the last days. */
function activity(messages: number[] = [], newMembers: number[] = []): OpsActivity {
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers each health probe by path with an HTTP status. */
function answerProbes(live: number, ready: number) {
  const statuses: Record<string, number> = { "/health/live": live, "/health/ready": ready };
  fetchMock.mockImplementation(async (input) => new Response(null, { status: statuses[String(input)] ?? 404 }));
}

function sessionWith(overview: Partial<OpsOverview>): OpsContextValue {
  const value = opsValue();
  return { ...value, bootstrap: { ...value.bootstrap!, overview: { ...value.bootstrap!.overview, ...overview } } };
}

function renderDashboard(value: OpsContextValue = opsValue()) {
  return render(
    <OpsContext.Provider value={value}>
      <DashboardPage />
    </OpsContext.Provider>,
  );
}

const counter = (title: string) => screen.getByRole("group", { name: title });
const serviceRow = (endpoint: RegExp) => screen.getByRole("row", { name: endpoint });

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
    expect(within(serviceRow(/PresenceTracker/)).getByText("9 połączeń")).toBeTruthy();
    expect(within(serviceRow(/Obiekty/)).getByText("1,5 KB")).toBeTruthy();
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

    expect(serviceRow(/Obiekty/).textContent).toContain(expected);
  });

  it("counts realtime connections in the services table", () => {
    answerProbes(200, 200);
    renderDashboard(sessionWith({ realtimeConnectionCount: 4 }));

    expect(within(serviceRow(/PresenceTracker/)).getByText("4 połączeń")).toBeTruthy();
  });

  it("renders nothing until the session has a bootstrap", () => {
    answerProbes(200, 200);
    const { container } = renderDashboard(opsValue({ phase: "loading", bootstrap: null }));

    expect(container.textContent).toBe("");
  });
});

describe("DashboardPage health", () => {
  it("shows the state of each probe on its own row", async () => {
    answerProbes(200, 503);
    renderDashboard();

    expect(await within(serviceRow(/\/health\/live/)).findByText("Działa")).toBeTruthy();
    expect(await within(serviceRow(/\/health\/ready/)).findByText("Niedostępne")).toBeTruthy();
  });

  it("reports both services unavailable when the first probe cannot connect", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderDashboard();

    expect(await within(serviceRow(/\/health\/live/)).findByText("Niedostępne")).toBeTruthy();
    expect(within(serviceRow(/\/health\/ready/)).getByText("Niedostępne")).toBeTruthy();
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
    const value = opsValue();
    renderDashboard(value);
    await waitFor(() => expect(screen.getAllByText("Działa")).toHaveLength(2));

    let answerRecheck!: (response: Response) => void;
    fetchMock.mockReset();
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answerRecheck = resolve)));
    await user.click(screen.getByRole("button", { name: "Sprawdź ponownie" }));

    expect(value.reload).toHaveBeenCalledOnce();
    expect(activityMock).toHaveBeenCalledTimes(2);
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
