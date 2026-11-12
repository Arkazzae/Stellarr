"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { MessageKey, Translator } from "@/i18n";
import type { Account, AuthResult, ConnectionStatus, Presence, User } from "@/ports";

import { useLanguage } from "./LanguageProvider";
import { usePorts, useRuntime } from "./PortsProvider";

/**
 * `anonymous` is a phase of its own rather than an error: a 401 is the answer
 * to "is anyone signed in", and it leads to the login screen, not to a retry.
 */
export type SessionPhase = "loading" | "ready" | "error" | "anonymous" | "revoked";

export interface SessionValue {
  phase: SessionPhase;
  user: User | null;
  /** The boot failure, already translated. Null unless the phase is `error` or `revoked`. */
  error: string | null;
  /** Control-plane health, straight off `ConnectionPort`. */
  connection: ConnectionStatus;
  /**
   * The status you chose for yourself, which your own row and account card
   * show. It starts as "online": a signed-in tab with a socket is online, and
   * nobody has to say so.
   */
  presence: Presence;
  setPresence: (presence: Presence) => void;
  /** Retries the bootstrap. */
  reload: () => void;
  /**
   * The first step of a sign-in. The app boots only when that was enough;
   * a challenge or a pending recovery is handed back for the sign-in page to
   * finish, and null means the attempt failed and `loginError` says why.
   */
  login: (username: string, password: string, keepSignedIn?: boolean) => Promise<AuthResult | null>;
  loginPending: boolean;
  loginError: string | null;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * What a failed request looks like, read structurally.
 *
 * `@/lib/api` is a transport and stays below the adapters, so the error class
 * is not imported to `instanceof` against; the two fields it carries are read
 * instead.
 */
interface RequestFailure {
  kind?: unknown;
  status?: unknown;
}

function failureOf(cause: unknown): RequestFailure {
  return typeof cause === "object" && cause !== null ? (cause as RequestFailure) : {};
}

const isUnauthorized = (cause: unknown): boolean => {
  const { kind, status } = failureOf(cause);
  return kind === "unauthorized" || status === 401;
};

const isForbidden = (cause: unknown): boolean => {
  const { kind, status } = failureOf(cause);
  return kind === "forbidden" || status === 403;
};

const FAILURE_MESSAGE: Partial<Record<string, MessageKey>> = {
  network: "session.network",
  unauthorized: "session.unauthorized",
  forbidden: "session.forbidden",
  "not-found": "session.notFound",
  invalid: "session.invalid",
  "rate-limited": "session.rateLimited",
  malformed: "session.malformed",
  server: "session.server",
};

/** The message for the failure's kind, or `fallback` when it has none. */
function messageFor(cause: unknown, t: Translator, fallback: MessageKey): string {
  const { kind } = failureOf(cause);
  const key = typeof kind === "string" ? FAILURE_MESSAGE[kind] : undefined;
  return t(key ?? fallback);
}

/** Your profile as the account holds it, laid over the identity the boot returned. */
function withProfileOf(user: User, account: Account): User {
  const { avatarUrl: _avatar, bannerUrl: _banner, ...rest } = user;
  return {
    ...rest,
    displayName: account.displayName,
    customStatus: account.customStatus,
    bio: account.bio,
    pronouns: account.pronouns,
    ...(account.avatarUrl === undefined ? {} : { avatarUrl: account.avatarUrl }),
    ...(account.bannerUrl === undefined ? {} : { bannerUrl: account.bannerUrl }),
  };
}

interface Boot {
  phase: SessionPhase;
  user: User | null;
  error: string | null;
}

const LOADING: Boot = { phase: "loading", user: null, error: null };
const ANONYMOUS: Boot = { phase: "anonymous", user: null, error: null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime();
  const ports = usePorts();
  const { t } = useLanguage();
  const [boot, setBoot] = useState<Boot>(LOADING);
  const [reloadToken, reload] = useReducer((count: number) => count + 1, 0);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence>("online");

  const connection = useSyncExternalStore(
    ports.connection.subscribe,
    ports.connection.getStatus,
    (): ConnectionStatus => "idle",
  );

  // A retry, or a swapped-out runtime, puts the session back to `loading`
  // before the bootstrap below runs again. The reset is derived from the inputs
  // during render, so the spinner lands in the same commit as the retry.
  const [lastRun, setLastRun] = useState({ ports, runtime, reloadToken });
  if (
    lastRun.ports !== ports ||
    lastRun.runtime !== runtime ||
    lastRun.reloadToken !== reloadToken
  ) {
    setLastRun({ ports, runtime, reloadToken });
    if (boot.phase !== "loading") setBoot(LOADING);
  }

  useEffect(() => {
    let active = true;

    async function bootstrap(): Promise<void> {
      try {
        const payload = await ports.session.bootstrap();
        if (!active) return;
        // Hydrating before the phase flips means the first `ready` render
        // already has channels and members instead of an empty rail.
        await runtime.hydrate(payload);
        if (!active) return;
        // The bootstrap precedes this tab's hub connection, so "offline" means
        // "not connected yet", not a deliberate invisible choice. Any other
        // status was advertised by another tab and is safe to inherit.
        setPresence(payload.user.presence === "offline" ? "online" : payload.user.presence);
        setBoot({
          phase: "ready",
          user: withProfileOf(payload.user, ports.account.getAccount()),
          error: null,
        });
      } catch (cause) {
        if (!active) return;
        if (isUnauthorized(cause)) setBoot(ANONYMOUS);
        else if (isForbidden(cause)) {
          setBoot({ phase: "revoked", user: null, error: t("session.accessRevoked") });
        } else {
          setBoot({
            phase: "error",
            user: null,
            error: messageFor(cause, t, "session.loadFailed"),
          });
        }
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [ports, runtime, reloadToken, t]);

  useEffect(
    () =>
      runtime.realtime.on("ServerAccessRevoked", ({ serverId, kind }) => {
        if (ports.directory.getServer().id !== serverId) return;
        setBoot({
          phase: "revoked",
          user: null,
          error: t(kind === "banned" ? "session.banned" : "session.kicked"),
        });
      }),
    [ports, runtime, t],
  );

  // A profile edit reaches everything that reads the session identity without
  // a reload. The directory store gets the same change through its own path.
  useEffect(
    () =>
      ports.account.onChanged(() => {
        const account = ports.account.getAccount();
        setBoot((current) =>
          current.user === null || current.user.id !== account.id
            ? current
            : { ...current, user: withProfileOf(current.user, account) },
        );
      }),
    [ports],
  );

  // The socket is strictly downstream of a bootstrap that returned a user.
  // Negotiating in parallel would have an anonymous visitor fire a request that
  // can only answer 401, racing the bootstrap that is about to answer 401 too.
  const signedIn = boot.phase === "ready" && boot.user !== null;

  useEffect(() => {
    if (!signedIn) return;
    // A failed start is not fatal: it shows through `connection`.
    void runtime.realtime.start().catch(() => undefined);
    return () => {
      // `stop` invalidates a pending negotiation at once and queues any later
      // `start` behind its own teardown.
      void runtime.realtime.stop().catch(() => undefined);
    };
  }, [runtime, signedIn]);

  // Another tab can change this account's status. It arrives as the same event
  // as everyone else's, so every account row reads back the advertised value.
  const userId = boot.user?.id;
  useEffect(() => {
    if (userId === undefined) return;
    return ports.presence.onPresenceChanged((changedId, next) => {
      if (changedId === userId) setPresence(next);
    });
  }, [ports, userId]);

  // The chosen status is asserted again after every reconnect. The hub echoes
  // it to every client, this one included, so the roster and the account row
  // converge on the value the backend owns.
  useEffect(() => {
    if (!signedIn || connection !== "connected") return;
    void ports.presence.setPresence(presence).catch(() => undefined);
  }, [ports, signedIn, connection, presence]);

  const login = useCallback(
    async (username: string, password: string, keepSignedIn = true) => {
      setLoginPending(true);
      setLoginError(null);
      try {
        const result = await ports.session.login({
          username,
          password,
          ...(keepSignedIn ? {} : { keepSignedIn: false }),
        });
        // A second factor is still due: nothing may boot, open the hub or
        // join voice until the challenge is answered.
        if (result.kind === "signed-in") reload();
        return result;
      } catch (cause) {
        setLoginError(
          isUnauthorized(cause)
            ? t("session.loginInvalid")
            : messageFor(cause, t, "session.loginFailed"),
        );
        return null;
      } finally {
        setLoginPending(false);
      }
    },
    [ports, t],
  );

  // A dropped hub is usually a network blip, which the client rides out. It
  // can also be the server ending this session: signed out on another
  // device, by an operator, or by a security change. Asking once per drop
  // tells the two apart; a session the server no longer knows stops the
  // reconnecting and leaves for the sign-in page, which unmounts voice.
  useEffect(() => {
    if (!signedIn || (connection !== "reconnecting" && connection !== "disconnected")) return;
    let active = true;
    ports.session.check().then(
      (alive) => {
        if (!active || alive) return;
        void runtime.realtime.stop().catch(() => undefined);
        setLoginError(t("session.unauthorized"));
        setBoot(ANONYMOUS);
      },
      // Unreachable is not signed out; the reconnect keeps trying.
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [connection, ports, runtime, signedIn, t]);

  const logout = useCallback(async () => {
    try {
      await ports.session.logout();
    } finally {
      // The socket goes down even when the request failed: the cookie may
      // already be gone, and an open hub would keep pushing into a signed-out tab.
      await runtime.realtime.stop().catch(() => undefined);
      setPresence("online");
      setBoot(ANONYMOUS);
    }
  }, [ports, runtime]);

  const value = useMemo<SessionValue>(
    () => ({
      phase: boot.phase,
      user: boot.user,
      error: boot.error,
      connection,
      presence,
      setPresence,
      reload,
      login,
      loginPending,
      loginError,
      logout,
    }),
    [boot, connection, presence, login, loginPending, loginError, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
}
