import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CockpitApiError, cockpitApi, type CockpitBootstrap } from "@/lib/api";
import { useCockpit } from "@/state/cockpit-context";
import { CockpitProvider } from "@/state/cockpit-provider";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  cockpitApi: { bootstrap: vi.fn(), login: vi.fn(), logout: vi.fn() },
}));

const bootstrapMock = vi.mocked(cockpitApi.bootstrap);
const loginMock = vi.mocked(cockpitApi.login);
const logoutMock = vi.mocked(cockpitApi.logout);

function bootstrapFor(instanceName: string): CockpitBootstrap {
  return {
    operator: { id: "op-1", username: "owner", displayName: "Ola Owner", avatarUrl: null },
    instance: { id: "inst-1", name: instanceName, createdAt: "2025-01-01T00:00:00Z" },
    overview: {
      userCount: 3,
      onlineUserCount: 1,
      realtimeConnectionCount: 1,
      storedObjectBytes: 0,
      messageCount: 12,
    },
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

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function renderOps() {
  return renderHook(() => useCockpit(), { wrapper: CockpitProvider });
}

function PhaseProbe() {
  return <p>{useCockpit().phase}</p>;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CockpitProvider loading", () => {
  it("starts loading and becomes ready with the bootstrap", async () => {
    const pending = deferred<CockpitBootstrap>();
    bootstrapMock.mockReturnValue(pending.promise);

    const { result } = renderOps();
    expect(result.current).toMatchObject({ phase: "loading", bootstrap: null, error: null });

    await act(async () => pending.resolve(bootstrapFor("Domek")));

    expect(result.current.phase).toBe("ready");
    expect(result.current.bootstrap?.instance.name).toBe("Domek");
    expect(result.current.error).toBeNull();
  });

  it("treats a 401 as anonymous and a 403 as forbidden, without an error message", async () => {
    bootstrapMock.mockRejectedValue(new CockpitApiError(401, "Brak sesji."));
    const anonymous = renderOps();
    await waitFor(() => expect(anonymous.result.current.phase).toBe("anonymous"));
    expect(anonymous.result.current.error).toBeNull();

    bootstrapMock.mockRejectedValue(new CockpitApiError(403, "Brak dostępu."));
    const forbidden = renderOps();
    await waitFor(() => expect(forbidden.result.current.phase).toBe("forbidden"));
    expect(forbidden.result.current.error).toBeNull();
  });

  it("reports any other failure as an error carrying its message", async () => {
    bootstrapMock.mockRejectedValue(new CockpitApiError(500, "Backend odpowiedział kodem 500."));

    const { result } = renderOps();

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Backend odpowiedział kodem 500.");
    expect(result.current.bootstrap).toBeNull();
  });

  it("falls back to a Polish message when the failure is not an Error", async () => {
    bootstrapMock.mockRejectedValue("boom");

    const { result } = renderOps();

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("Nie udało się uruchomić Cockpitu.");
  });

  it("ignores the request StrictMode aborts and keeps loading until the second one answers", async () => {
    const answers: Array<ReturnType<typeof deferred<CockpitBootstrap>>> = [];
    const signals: Array<AbortSignal | undefined> = [];
    bootstrapMock.mockImplementation((signal) => {
      const answer = deferred<CockpitBootstrap>();
      answers.push(answer);
      signals.push(signal);
      signal?.addEventListener("abort", () => answer.reject(abortError()));
      return answer.promise;
    });

    render(
      <StrictMode>
        <CockpitProvider>
          <PhaseProbe />
        </CockpitProvider>
      </StrictMode>,
    );
    await act(async () => {});

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(screen.getByText("loading")).toBeTruthy();

    await act(async () => answers[1]?.resolve(bootstrapFor("Domek")));
    expect(screen.getByText("ready")).toBeTruthy();
  });

  it("aborts the pending bootstrap request when the provider unmounts", () => {
    let signal: AbortSignal | undefined;
    bootstrapMock.mockImplementation((given) => {
      signal = given;
      return new Promise(() => {});
    });

    const { unmount } = renderOps();
    expect(signal?.aborted).toBe(false);
    unmount();

    expect(signal?.aborted).toBe(true);
  });
});

describe("login", () => {
  it("posts the credentials, shows loading, then loads the bootstrap", async () => {
    bootstrapMock.mockRejectedValueOnce(new CockpitApiError(401, "Brak sesji."));
    const { result } = renderOps();
    await waitFor(() => expect(result.current.phase).toBe("anonymous"));

    const reloaded = deferred<CockpitBootstrap>();
    loginMock.mockResolvedValue(undefined);
    bootstrapMock.mockReturnValueOnce(reloaded.promise);

    let signIn!: Promise<void>;
    act(() => {
      signIn = result.current.login("owner", "sekret");
    });
    await waitFor(() => expect(result.current.phase).toBe("loading"));
    expect(loginMock).toHaveBeenCalledWith("owner", "sekret");

    await act(async () => {
      reloaded.resolve(bootstrapFor("Domek"));
      await signIn;
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.bootstrap?.instance.name).toBe("Domek");
  });

  it("rejects a failed login to the caller and leaves the phase alone", async () => {
    bootstrapMock.mockRejectedValueOnce(new CockpitApiError(401, "Brak sesji."));
    const { result } = renderOps();
    await waitFor(() => expect(result.current.phase).toBe("anonymous"));

    const refusal = new CockpitApiError(401, "Nieprawidłowy login lub hasło.");
    loginMock.mockRejectedValue(refusal);

    await act(async () => {
      await expect(result.current.login("owner", "zle")).rejects.toBe(refusal);
    });

    expect(result.current.phase).toBe("anonymous");
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });
});

describe("logout", () => {
  it("posts the logout, drops the bootstrap and goes anonymous", async () => {
    bootstrapMock.mockResolvedValue(bootstrapFor("Domek"));
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderOps();
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.logout());

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ phase: "anonymous", bootstrap: null, error: null });
  });
});

describe("reload", () => {
  it("keeps the current screen while a ready session refreshes", async () => {
    bootstrapMock.mockResolvedValueOnce(bootstrapFor("Domek"));
    const { result } = renderOps();
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    const refreshed = deferred<CockpitBootstrap>();
    bootstrapMock.mockReturnValueOnce(refreshed.promise);
    let reloading!: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });

    expect(result.current.phase).toBe("ready");
    expect(result.current.bootstrap?.instance.name).toBe("Domek");

    await act(async () => {
      refreshed.resolve(bootstrapFor("Dom nad jeziorem"));
      await reloading;
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.bootstrap?.instance.name).toBe("Dom nad jeziorem");
  });

  it("shows loading when the session was not ready, then recovers", async () => {
    bootstrapMock.mockRejectedValueOnce(new CockpitApiError(500, "Backend padł."));
    const { result } = renderOps();
    await waitFor(() => expect(result.current.phase).toBe("error"));

    const retried = deferred<CockpitBootstrap>();
    bootstrapMock.mockReturnValueOnce(retried.promise);
    let reloading!: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });
    expect(result.current.phase).toBe("loading");

    await act(async () => {
      retried.resolve(bootstrapFor("Domek"));
      await reloading;
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.error).toBeNull();
  });

  it("goes anonymous when the refresh finds the session gone", async () => {
    bootstrapMock.mockResolvedValueOnce(bootstrapFor("Domek"));
    const { result } = renderOps();
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    bootstrapMock.mockRejectedValueOnce(new CockpitApiError(401, "Brak sesji."));
    await act(async () => result.current.reload());

    expect(result.current).toMatchObject({ phase: "anonymous", bootstrap: null });
  });
});

describe("useCockpit", () => {
  it("throws outside the provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCockpit())).toThrow("useCockpit must be used inside CockpitProvider");
    error.mockRestore();
  });
});
