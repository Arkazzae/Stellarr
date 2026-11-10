import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime, type Runtime } from "@/adapters";
import { translateMessage, type MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { BOOTSTRAP, FakeRealtimeClient, SELF, SERVER } from "@/test/fakes";
import { fullApi, type FullApi } from "@/test/runtime";

import { LanguageProvider } from "./LanguageProvider";
import { PortsProvider } from "./PortsProvider";
import { SessionProvider, useSessionContext } from "./SessionProvider";

const polish = (key: MessageKey): string => translateMessage("pl", key);

function Probe() {
  const session = useSessionContext();
  return (
    <div>
      <output aria-label="phase">{session.phase}</output>
      <output aria-label="user">{session.user?.displayName ?? "none"}</output>
      <output aria-label="error">{session.error ?? "none"}</output>
      <output aria-label="connection">{session.connection}</output>
      <output aria-label="presence">{session.presence}</output>
      <output aria-label="login-error">{session.loginError ?? "none"}</output>
      <output aria-label="login-pending">{String(session.loginPending)}</output>
      <button type="button" onClick={() => void session.login("maja", "secret")}>
        Log in
      </button>
      <button type="button" onClick={() => void session.logout().catch(() => undefined)}>
        Log out
      </button>
      <button type="button" onClick={session.reload}>
        Reload
      </button>
      <button type="button" onClick={() => session.setPresence("dnd")}>
        Do not disturb
      </button>
    </div>
  );
}

const runtimes: Runtime[] = [];

function mount(api: FullApi) {
  const realtime = new FakeRealtimeClient();
  const runtime = createRuntime({ api, realtime });
  runtimes.push(runtime);
  render(
    <LanguageProvider initialLocale="pl">
      <PortsProvider runtime={runtime}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </PortsProvider>
    </LanguageProvider>,
  );
  return { runtime, realtime, api };
}

const unauthorized = () => new ApiError("unauthorized", "Unauthorized", 401);

/** A bootstrap that answers with the signed-in person unless a test says otherwise. */
const bootstrapped = () => vi.fn<FullApi["bootstrap"]>(async () => BOOTSTRAP);

const phase = () => screen.getByLabelText("phase");

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe("SessionProvider boot", () => {
  it("is ready with the signed-in person once the bootstrap succeeds", async () => {
    const { realtime } = mount(fullApi());

    expect(phase()).toHaveTextContent("loading");
    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    expect(screen.getByLabelText("user")).toHaveTextContent("Maja");
    expect(screen.getByLabelText("error")).toHaveTextContent("none");
    await waitFor(() => expect(realtime.getStatus()).toBe("connected"));
    expect(screen.getByLabelText("connection")).toHaveTextContent("connected");
  });

  it("seeds the stores before it reports ready", async () => {
    const { runtime } = mount(fullApi());

    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    expect(runtime.ports.directory.getServer()).toEqual(SERVER);
    expect(runtime.ports.account.getAccount().id).toBe(SELF.id);
  });

  it("goes anonymous on a 401 and never opens the socket", async () => {
    const { realtime } = mount(
      fullApi({ bootstrap: bootstrapped().mockRejectedValueOnce(unauthorized()) }),
    );

    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));

    expect(screen.getByLabelText("error")).toHaveTextContent("none");
    expect(realtime.getStatus()).toBe("idle");
  });

  it("reads an unauthorized failure by its shape, not its class", async () => {
    mount(fullApi({ bootstrap: bootstrapped().mockRejectedValueOnce({ status: 401 }) }));

    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));
  });

  it("reports revoked access on a 403", async () => {
    mount(
      fullApi({
        bootstrap: bootstrapped().mockRejectedValueOnce(
          new ApiError("forbidden", "Forbidden", 403),
        ),
      }),
    );

    await waitFor(() => expect(phase()).toHaveTextContent("revoked"));

    expect(screen.getByLabelText("error")).toHaveTextContent(polish("session.accessRevoked"));
  });

  it("shows the catalog message for the kind of a failed bootstrap", async () => {
    mount(
      fullApi({
        bootstrap: bootstrapped().mockRejectedValueOnce(new ApiError("network", "offline")),
      }),
    );

    await waitFor(() => expect(phase()).toHaveTextContent("error"));

    expect(screen.getByLabelText("error")).toHaveTextContent(polish("session.network"));
    expect(screen.getByLabelText("user")).toHaveTextContent("none");
  });

  it("falls back to the generic message for a failure it cannot classify", async () => {
    mount(fullApi({ bootstrap: bootstrapped().mockRejectedValueOnce(new Error("boom")) }));

    await waitFor(() => expect(phase()).toHaveTextContent("error"));

    expect(screen.getByLabelText("error")).toHaveTextContent(polish("session.loadFailed"));
  });

  it("shows the loading phase again while a retry runs, then recovers", async () => {
    const user = userEvent.setup();
    const api = fullApi({
      bootstrap: bootstrapped().mockRejectedValueOnce(new ApiError("server", "Server error", 500)),
    });
    mount(api);
    await waitFor(() => expect(phase()).toHaveTextContent("error"));

    await user.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(phase()).toHaveTextContent("ready"));
    expect(api.bootstrap).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("error")).toHaveTextContent("none");
  });
});

describe("SessionProvider login", () => {
  it("takes an anonymous visitor to ready after a successful login", async () => {
    const user = userEvent.setup();
    const api = fullApi({ bootstrap: bootstrapped().mockRejectedValueOnce(unauthorized()) });
    const { realtime } = mount(api);
    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));

    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(phase()).toHaveTextContent("ready"));
    expect(api.login).toHaveBeenCalledWith({ username: "maja", password: "secret" });
    expect(screen.getByLabelText("login-pending")).toHaveTextContent("false");
    await waitFor(() => expect(realtime.getStatus()).toBe("connected"));
  });

  it("says the credentials are wrong when the server answers 401", async () => {
    const user = userEvent.setup();
    const api = fullApi({
      bootstrap: bootstrapped().mockRejectedValueOnce(unauthorized()),
      login: vi.fn(async () => {
        throw unauthorized();
      }),
    });
    mount(api);
    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));

    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByLabelText("login-error")).toHaveTextContent(
        polish("session.loginInvalid"),
      ),
    );
    expect(phase()).toHaveTextContent("anonymous");
  });

  it("uses the message of the failure kind for any other login error", async () => {
    const user = userEvent.setup();
    const api = fullApi({
      bootstrap: bootstrapped().mockRejectedValueOnce(unauthorized()),
      login: vi.fn(async () => {
        throw new ApiError("rate-limited", "Slow down", 429);
      }),
    });
    mount(api);
    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));

    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(screen.getByLabelText("login-error")).toHaveTextContent(
        polish("session.rateLimited"),
      ),
    );
  });
});

describe("SessionProvider logout", () => {
  it("stops the socket and returns to anonymous", async () => {
    const user = userEvent.setup();
    const api = fullApi();
    const { realtime } = mount(api);
    await waitFor(() => expect(realtime.getStatus()).toBe("connected"));

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));
    expect(api.logout).toHaveBeenCalledOnce();
    expect(realtime.getStatus()).toBe("idle");
    expect(screen.getByLabelText("user")).toHaveTextContent("none");
  });

  it("signs out locally even when the request fails", async () => {
    const user = userEvent.setup();
    const api = fullApi({
      logout: vi.fn(async () => {
        throw new ApiError("network", "offline");
      }),
    });
    const { realtime } = mount(api);
    await waitFor(() => expect(realtime.getStatus()).toBe("connected"));

    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(phase()).toHaveTextContent("anonymous"));
    expect(realtime.getStatus()).toBe("idle");
  });
});

describe("SessionProvider while signed in", () => {
  it("is revoked when the open server bans or removes you", async () => {
    const { realtime } = mount(fullApi());
    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    act(() => realtime.push("ServerAccessRevoked", { serverId: SERVER.id, kind: "banned" }));

    expect(phase()).toHaveTextContent("revoked");
    expect(screen.getByLabelText("error")).toHaveTextContent(polish("session.banned"));
  });

  it("says kicked when the removal is not a ban", async () => {
    const { realtime } = mount(fullApi());
    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    act(() => realtime.push("ServerAccessRevoked", { serverId: SERVER.id, kind: "kicked" }));

    expect(screen.getByLabelText("error")).toHaveTextContent(polish("session.kicked"));
  });

  it("ignores a revocation on a server that is not open", async () => {
    const { realtime } = mount(fullApi());
    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    act(() => realtime.push("ServerAccessRevoked", { serverId: "srv-other", kind: "banned" }));

    expect(phase()).toHaveTextContent("ready");
  });

  it("shows a profile edit without a reload", async () => {
    const { runtime } = mount(fullApi());
    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    await act(() => runtime.ports.account.update({ displayName: "Maja K." }));

    expect(screen.getByLabelText("user")).toHaveTextContent("Maja K.");
  });
});

describe("SessionProvider presence", () => {
  it("treats an offline bootstrap as online, because the socket is not up yet", async () => {
    mount(
      fullApi({
        bootstrap: bootstrapped().mockResolvedValueOnce({
          ...BOOTSTRAP,
          user: { ...SELF, presence: "offline" },
        }),
      }),
    );

    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    expect(screen.getByLabelText("presence")).toHaveTextContent("online");
  });

  it("inherits a status another tab already advertised", async () => {
    mount(
      fullApi({
        bootstrap: bootstrapped().mockResolvedValueOnce({
          ...BOOTSTRAP,
          user: { ...SELF, presence: "idle" },
        }),
      }),
    );

    await waitFor(() => expect(phase()).toHaveTextContent("ready"));

    expect(screen.getByLabelText("presence")).toHaveTextContent("idle");
  });

  it("sends the chosen status once connected and again after a choice", async () => {
    const user = userEvent.setup();
    const { realtime } = mount(fullApi());
    const send = vi.spyOn(realtime, "setPresence");
    await waitFor(() => expect(send).toHaveBeenCalledWith("online"));

    await user.click(screen.getByRole("button", { name: "Do not disturb" }));

    await waitFor(() => expect(send).toHaveBeenLastCalledWith("dnd"));
    expect(screen.getByLabelText("presence")).toHaveTextContent("dnd");
  });

  it("follows a status change made from another tab, but not someone else's", async () => {
    const { realtime } = mount(fullApi());
    await waitFor(() => expect(screen.getByLabelText("connection")).toHaveTextContent("connected"));

    act(() => realtime.push("PresenceChanged", { userId: "u-ada", presence: "dnd" }));
    expect(screen.getByLabelText("presence")).toHaveTextContent("online");

    act(() => realtime.push("PresenceChanged", { userId: SELF.id, presence: "idle" }));
    expect(screen.getByLabelText("presence")).toHaveTextContent("idle");
  });
});
