import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppGate } from "@/components/app-gate";
import { AppShell } from "@/components/app-shell";
import { OpsApiError, opsApi, type OpsBackups, type OpsRuntime, type OpsUsers } from "@/lib/api";
import { BackupsPage } from "@/pages/backups-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { RuntimePage } from "@/pages/runtime-page";
import { UsersPage } from "@/pages/users-page";
import { OpsContext, type OpsContextValue } from "@/state/ops-context";
import { opsValue } from "@/test/ops-fixtures";

// These tests never select a language: English is what the panel shows by default.

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    opsApi: {
      ...original.opsApi,
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

function renderWithSession(ui: React.ReactNode, value: OpsContextValue = opsValue()) {
  return render(
    <MemoryRouter>
      <OpsContext.Provider value={value}>{ui}</OpsContext.Provider>
    </MemoryRouter>,
  );
}

describe("the sign-in screen", () => {
  const anonymous = { phase: "anonymous", bootstrap: null } as const;

  it("is in English", () => {
    renderWithSession(<AppGate />, opsValue(anonymous));

    expect(screen.getByText("Log in to Stellarr OPs")).toBeTruthy();
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("explains too many attempts in English", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new OpsApiError(429, "Too Many Requests"));
    renderWithSession(<AppGate />, opsValue({ ...anonymous, login }));

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
        <OpsContext.Provider value={opsValue()}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<p>Page</p>} />
            </Route>
          </Routes>
        </OpsContext.Provider>
      </MemoryRouter>,
    );

    const [sidebar] = screen.getAllByRole("navigation", { name: "OPs navigation" });
    const labels = within(sidebar!)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "Overview",
      "Users",
      "Runtime",
      "Logs and audit",
      "Backups",
      "Releases",
      "Settings",
    ]);
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Local instance")).toBeTruthy();
  });
});

describe("the overview", () => {
  it("counts in English and groups digits like English", () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    const value = opsValue();
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
          },
        },
      },
    );

    const users = screen.getByRole("group", { name: "Users" }).textContent;
    expect(users).toContain("12,345");
    expect(users).toContain("7 online");
    expect(screen.getByRole("group", { name: "Stored objects" }).textContent).toContain("1.5 KB");
    expect(screen.getByRole("group", { name: "Messages" }).textContent).toContain("987,654");
  });

  it("states the realtime connection count without a plural form", () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    const value = opsValue();
    renderWithSession(<DashboardPage />, {
      ...value,
      bootstrap: {
        ...value.bootstrap!,
        overview: { ...value.bootstrap!.overview, realtimeConnectionCount: 1 },
      },
    });

    expect(screen.getByRole("row", { name: /PresenceTracker/ }).textContent).toContain(
      "Connections: 1",
    );
  });
});

describe("the runtime page", () => {
  const runtime: OpsRuntime = {
    startedAt: "2025-03-04T10:15:00Z",
    uptimeSeconds: 90061,
    workingSetBytes: 512 * 1024 * 1024,
    gcHeapBytes: 12.5 * 1024 * 1024,
    threadCount: 31,
    realtimeConnections: 4,
    voiceRooms: 2,
    databaseLatencyMs: 1234.5,
    services: [{ name: "SQLite", state: "warning", detail: "Slow" }],
  };

  it("formats durations, sizes, numbers and dates for English", async () => {
    vi.mocked(opsApi.runtime).mockResolvedValue(runtime);
    render(<RuntimePage />);

    const metric = async (label: string) =>
      (await screen.findByRole("group", { name: label })).textContent ?? "";
    expect(await metric("Uptime")).toContain("1 d 1 h 1 min");
    expect(await metric("Process memory")).toContain("512 MB");
    expect(await metric("GC heap")).toContain("12.5 MB");
    expect(await metric("SQLite latency")).toContain("1,234.5 ms");
    expect(await metric("Process started")).toContain(
      new Date(runtime.startedAt).toLocaleString("en-GB"),
    );
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });
});

describe("the backups page", () => {
  it("labels the empty summary and the retention in English", async () => {
    const empty: OpsBackups = { backups: [], retentionDays: 1 };
    vi.mocked(opsApi.backups).mockResolvedValue(empty);
    render(<BackupsPage />);

    expect(await screen.findByRole("group", { name: "Backups · retention (days): 1" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Latest backup" }).textContent).toContain("None");
    expect(screen.getByText("No backups have been created yet.")).toBeTruthy();
  });
});

describe("the users page", () => {
  const directory: OpsUsers = {
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
    vi.mocked(opsApi.users).mockResolvedValue(directory);
    vi.mocked(opsApi.sessions).mockResolvedValue([]);
    render(<UsersPage />);

    expect(await screen.findByText("Accounts in the instance: 1.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Sessions (0)" })).toBeTruthy();
    expect(screen.getByText("◐ Away")).toBeTruthy();
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
    const { opsApi: real } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    fetchMock.mockRejectedValue(new TypeError("network down"));

    await expect(real.bootstrap()).rejects.toMatchObject({
      status: 0,
      message: "Could not reach the Stellarr backend.",
    });
  });

  it("name the status when the backend sends no explanation", async () => {
    const { opsApi: real } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));

    await expect(real.bootstrap()).rejects.toMatchObject({
      status: 502,
      message: "The backend responded with status 502.",
    });
  });
});
