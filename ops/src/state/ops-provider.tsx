import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { t } from "@/i18n";
import { OpsApiError, opsApi, type OpsBootstrap } from "@/lib/api";
import { OpsContext, type OpsContextValue, type OpsPhase } from "@/state/ops-context";

interface Session {
  phase: OpsPhase;
  bootstrap: OpsBootstrap | null;
  error: string | null;
}

const LOADING: Session = { phase: "loading", bootstrap: null, error: null };
const ANONYMOUS: Session = { phase: "anonymous", bootstrap: null, error: null };

/** A 401 means nobody is signed in, a 403 that the account is not the owner. */
function sessionAfterFailure(cause: unknown): Session {
  if (cause instanceof OpsApiError && cause.status === 401) return ANONYMOUS;
  if (cause instanceof OpsApiError && cause.status === 403) {
    return { phase: "forbidden", bootstrap: null, error: null };
  }
  return {
    phase: "error",
    bootstrap: null,
    error: cause instanceof Error ? cause.message : t("session.startFailed"),
  };
}

export function OpsProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(LOADING);

  const load = useCallback(
    (signal?: AbortSignal) =>
      opsApi.bootstrap(signal).then(
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

  const reload = useCallback(async () => {
    setSession((current) => (current.phase === "ready" ? current : LOADING));
    await load();
  }, [load]);

  const login = useCallback(
    async (username: string, password: string) => {
      await opsApi.login(username, password);
      setSession(LOADING);
      await load();
    },
    [load],
  );

  const logout = useCallback(async () => {
    await opsApi.logout();
    setSession(ANONYMOUS);
  }, []);

  const value = useMemo<OpsContextValue>(
    () => ({ ...session, reload, login, logout }),
    [session, reload, login, logout],
  );

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}
