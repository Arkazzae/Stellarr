import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { t } from "@/i18n";
import { CockpitApiError, cockpitApi, type CockpitBootstrap } from "@/lib/api";
import { CockpitContext, type CockpitContextValue, type CockpitPhase } from "@/state/cockpit-context";

interface Session {
  phase: CockpitPhase;
  bootstrap: CockpitBootstrap | null;
  error: string | null;
}

const LOADING: Session = { phase: "loading", bootstrap: null, error: null };
const ANONYMOUS: Session = { phase: "anonymous", bootstrap: null, error: null };

/** A 401 means nobody is signed in, a 403 that the account is not the owner. */
function sessionAfterFailure(cause: unknown): Session {
  if (cause instanceof CockpitApiError && cause.status === 401) return ANONYMOUS;
  if (cause instanceof CockpitApiError && cause.status === 403) {
    return { phase: "forbidden", bootstrap: null, error: null };
  }
  return {
    phase: "error",
    bootstrap: null,
    error: cause instanceof Error ? cause.message : t("session.startFailed"),
  };
}

export function CockpitProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(LOADING);

  const load = useCallback(
    (signal?: AbortSignal) =>
      cockpitApi.bootstrap(signal).then(
        (bootstrap) => {
          if (!signal?.aborted) setSession({ phase: "ready", bootstrap, error: null });
        },
        (cause: unknown) => {
          if (!signal?.aborted) setSession(sessionAfterFailure(cause));
        },
      ),
    [],
  );

  useEffect(() => {
    // StrictMode mounts twice; the first request is aborted and must not touch state.
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // A ready session that fails to refresh keeps what it shows unless the
  // session itself is gone: a dropped connection is not a reason to leave the
  // panel, and the overview refreshes every 30 s while the API may be down.
  const reload = useCallback(async () => {
    setSession((current) => (current.phase === "ready" ? current : LOADING));
    try {
      setSession({ phase: "ready", bootstrap: await cockpitApi.bootstrap(), error: null });
    } catch (cause) {
      const after = sessionAfterFailure(cause);
      setSession((current) => (current.phase === "ready" && after.phase === "error" ? current : after));
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      await cockpitApi.login(username, password);
      setSession(LOADING);
      await load();
    },
    [load],
  );

  const logout = useCallback(async () => {
    await cockpitApi.logout();
    setSession(ANONYMOUS);
  }, []);

  const value = useMemo<CockpitContextValue>(
    () => ({ ...session, reload, login, logout }),
    [session, reload, login, logout],
  );

  return <CockpitContext.Provider value={value}>{children}</CockpitContext.Provider>;
}
