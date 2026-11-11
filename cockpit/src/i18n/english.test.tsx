import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppGate } from "@/components/app-gate";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CockpitApiError, cockpitApi, type CockpitBackups, type CockpitRuntime, type CockpitUsers } from "@/lib/api";
import { BackupsPage } from "@/pages/backups-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { RuntimePage } from "@/pages/runtime-page";
import { UsersPage } from "@/pages/users-page";
import { CockpitContext, type CockpitContextValue } from "@/state/cockpit-context";
import { cockpitValue } from "@/test/cockpit-fixtures";

// These tests never select a language: English is what the panel shows by default.

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: {
      ...original.cockpitApi,
      activity: vi.fn(),
      runtime: vi.fn(),
      backups: vi.fn(),
      users: vi.fn(),
      sessions: vi.fn(),
    },
  };
});

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWithSession(ui: React.ReactNode, value: CockpitContextValue = cockpitValue()) {
  return render(
    <MemoryRouter>
      <CockpitContext.Provider value={value}>
        <TooltipProvider>{ui}</TooltipProvider>
      </CockpitContext.Provider>
    </MemoryRouter>,
  );
}

describe("the sign-in screen", () => {
  const anonymous = { phase: "anonymous", bootstrap: null } as const;

  it("is in English", () => {
    renderWithSession(<AppGate />, cockpitValue(anonymous));

    expect(screen.getByText("Log in to Stellarr Cockpit")).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("explains too many attempts in English", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new CockpitApiError(429, "Too Many Requests"));
    renderWithSession(<AppGate />, cockpitValue({ ...anonymous, login }));

    await user.type(screen.getByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Too many login attempts. Try again in a moment.",
    );
  });
});

describe("the navigation shell", () => {
  it("names the areas and the current page in English", () => {
    render(
      <MemoryRouter initialEntries={["/logs"]}>
        <CockpitContext.Provider value={cockpitValue()}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<p>Page</p>} />
            </Route>
          </Routes>
        </CockpitContext.Provider>
      </MemoryRouter>,
    );

    const [sidebar] = screen.getAllByRole("navigation", { name: "Cockpit navigation" });
    const labels = within(sidebar!)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "Overview",
      "Users",
      "Servers",
      "Runtime",
      "Logs",
      "Backups",
      "Integrations",
      "Settings",
    ]);
    expect(within(screen.getByRole("banner")).getByText("Logs")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
  });
});

describe("the overview", () => {
  beforeEach(() => {
    vi.mocked(cockpitApi.runtime).mockReturnValue(new Promise(() => {}));
    vi.mocked(cockpitApi.activity).mockReturnValue(new Promise(() => {}));
  });

  it("counts in English and groups digits like English", () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    const value = cockpitValue();
    renderWithSession(
      <DashboardPage />,
      {
        ...value,
        bootstrap: {
          ...value.bootstrap!,
          overview: {
            userCount: 12345,
            onlineUserCount: 7,
            realtimeConnectionCount: 9,
            storedObjectBytes: 1536,
            messageCount: 987654,
            serverCount: 3,
            publicServerCount: 2,
          },
        },
      },
    );

    const users = screen.getByRole("group", { name: "Users" }).textContent;
    expect(users).toContain("12,345");
    expect(users).toContain("7 online");
    expect(screen.getByRole("group", { name: "Storage" }).textContent).toContain("1.5 KB");
    expect(screen.getByRole("group", { name: "Messages" }).textContent).toContain("987,654");
    expect(screen.getByRole("group", { name: "Servers" }).textContent).toContain("public: 2");
  });

  it("names the activity series in English", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    const day = { messages: 1200, newMembers: 0, activeUsers: 2, reactions: 0, uploads: 0, signIns: 1 };
    vi.mocked(cockpitApi.activity).mockResolvedValue({
      timeZone: "Europe/London",
      activeUsers: 3,
      days: Array.from({ length: 30 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, ...day })),
    });
    renderWithSession(<DashboardPage />, cockpitValue());

    expect((await screen.findByRole("tab", { name: /Messages/ })).textContent).toContain("36,000");
    expect(screen.getByRole("tab", { name: /Active users/ }).textContent).toContain("3");
    expect(screen.getByRole("tab", { name: /Sign-ins/ }).textContent).toContain("30");
    expect(screen.getByText("Last 30 days, Europe/London")).toBeTruthy();
  });

  it("names the availability in English", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    renderWithSession(<DashboardPage />, cockpitValue());

    expect(screen.getByText("Availability")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Database" }).textContent).toContain("SQLite, checked every 30 s");
    expect(await screen.findByText("All systems up")).toBeTruthy();
  });
});

describe("the runtime page", () => {
  const runtime: CockpitRuntime = {
    startedAt: "2025-03-04T10:15:00Z",
    uptimeSeconds: 90061,
    workingSetBytes: 512 * 1024 * 1024,
    gcHeapBytes: 12.5 * 1024 * 1024,
    threadCount: 31,
    realtimeConnections: 4,
    voiceRooms: 2,
    databaseLatencyMs: 1234.5,
    services: [{ name: "SQLite", state: "warning", detail: "Slow" }],
    cpuPercent: 7.25,
    sampleSeconds: 30,
    history: [],
  };

  it("formats durations, sizes, numbers and dates for English", async () => {
    vi.mocked(cockpitApi.runtime).mockResolvedValue(runtime);
    render(<RuntimePage />);

    const metric = async (label: string) =>
      (await screen.findByRole("group", { name: label })).textContent ?? "";
    expect(await metric("Process memory")).toContain("512MB");
    expect(await metric("Process memory")).toContain("GC heap 12.5 MB, threads: 31");
    expect(await metric("SQLite latency")).toContain("1,234.5ms");
    expect(await metric("CPU")).toContain("7.3%");
    expect(
      screen.getByText(
        `The process has run for 1 d 1 h 1 min, since ${new Date(runtime.startedAt).toLocaleString("en-GB")}.`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });
});

describe("the backups page", () => {
  it("labels the empty summary and the retention in English", async () => {
    const empty: CockpitBackups = { backups: [], retentionDays: 1 };
    vi.mocked(cockpitApi.backups).mockResolvedValue(empty);
    render(<BackupsPage />);

    expect(await screen.findByRole("group", { name: "Backups · retention (days): 1" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Latest backup" }).textContent).toContain("None");
    expect(screen.getByText("No backups have been created yet.")).toBeTruthy();
  });
});

describe("the users page", () => {
  const directory: CockpitUsers = {
    sessionRegistryAvailable: true,
    roles: [
      {
        id: "role-member",
        name: "Member",
        color: "#64748b",
        permissions: ["manageMessages"],
        memberCount: 1,
        isSystem: false,
        isOwner: false,
      },
    ],
    users: [
      {
        id: "u-ben",
        username: "ben",
        displayName: "Ben Kowalski",
        email: null,
        avatarColor: "#123456",
        avatarUrl: null,
        presence: "idle",
        realtimeConnections: 0,
        roleId: "role-member",
        roleName: "Member",
        isDisabled: false,
        joinedAt: "2025-02-03T09:30:00Z",
        createdAt: "2025-02-03T09:30:00Z",
      },
    ],
  };

  it("fills named values into counts and labels", async () => {
    vi.mocked(cockpitApi.users).mockResolvedValue(directory);
    vi.mocked(cockpitApi.sessions).mockResolvedValue([]);
    render(<UsersPage />);

    expect(await screen.findByText("Accounts in the instance: 1.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sessions (0)" })).toBeTruthy();
    expect(screen.getByText("Away")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for Ben Kowalski" })).toBeTruthy();
  });
});

describe("the unknown page", () => {
  it("is in English", () => {
    renderWithSession(<NotFoundPage />);

    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the overview" })).toBeTruthy();
  });
});

describe("api failures", () => {
  it("are reported in English when the backend is unreachable", async () => {
    const { cockpitApi: real } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    fetchMock.mockRejectedValue(new TypeError("network down"));

    await expect(real.bootstrap()).rejects.toMatchObject({
      status: 0,
      message: "Could not reach the Stellarr backend.",
    });
  });

  it("name the status when the backend sends no explanation", async () => {
    const { cockpitApi: real } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

    await expect(real.bootstrap()).rejects.toMatchObject({
      status: 502,
      message: "The backend responded with status 502.",
    });
  });
});
