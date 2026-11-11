import type { IceServerConfig, RtcConfig } from "@/lib/api/types";
import { resolveIceServers } from "./iceConfig";

/**
 * How much validity a credential must have left to be worth using. coturn
 * checks the expiry when an allocation is made, not continuously, so the margin
 * only has to cover the time between choosing the list and ICE allocating a
 * relay. A generous margin costs nothing; a tight one fails the call.
 */
export const TURN_SAFETY_MARGIN_MS = 5 * 60_000;

/**
 * Expiry encoded in a coturn REST username, as epoch milliseconds.
 *
 * The server mints `<unix-expiry>:<userId>` and HMACs it (see
 * `TurnCredentialService`), so reading the expiry back is the only way to tell
 * a usable credential from a dead one without trying it.
 *
 * Null means the username is not time-limited at all, such as a static
 * credential. "No expiry" and "expired" must never be confused.
 */
export function turnCredentialExpiry(username: unknown): number | null {
  if (typeof username !== "string") return null;
  const [head, ...rest] = username.split(":");
  if (rest.length === 0 || !head || !/^\d+$/.test(head)) return null;
  const seconds = Number(head);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export interface IceFallbackDecision {
  /** True when the pruned list is safe to start a session on. */
  usable: boolean;
  /**
   * The input with every credential that is expired or inside the margin
   * removed. Pruned even when `usable` is false, so nothing that reads the list
   * for another purpose can get hold of a dead credential.
   */
  servers: RTCIceServer[];
}

/**
 * Decides whether a cached ICE list may stand in for a failed refresh.
 *
 * Handing `RTCPeerConnection` a dead TURN credential does not fail loudly: no
 * relay is ever allocated, and the call fails minutes later for whoever sits
 * behind symmetric NAT. So dead entries are always dropped.
 *
 * A list with no time-limited credential (STUN only) can never go stale and
 * stays usable. A list whose time-limited credentials have all died does not,
 * even when STUN survives, because STUN alone cannot carry a symmetric-NAT call.
 */
export function evaluateIceFallback(
  servers: readonly RTCIceServer[],
  nowMs: number,
  marginMs: number = TURN_SAFETY_MARGIN_MS,
): IceFallbackDecision {
  const entries = servers.map((server) => ({
    server,
    expiry: turnCredentialExpiry(server.username),
  }));
  const kept = entries.filter(({ expiry }) => expiry === null || expiry - nowMs > marginMs);
  const timeLimited = entries.filter(({ expiry }) => expiry !== null);
  const timeLimitedKept = kept.filter(({ expiry }) => expiry !== null);

  return {
    usable: servers.length > 0 && (timeLimited.length === 0 || timeLimitedKept.length > 0),
    servers: kept.map(({ server }) => server),
  };
}

export type IceConfigErrorKind = "expired" | "unavailable";

export class IceConfigError extends Error {
  readonly kind: IceConfigErrorKind;

  constructor(kind: IceConfigErrorKind, message: string) {
    super(message);
    this.name = "IceConfigError";
    this.kind = kind;
  }
}

/**
 * Supplies ICE servers to a voice session. `beginSession` runs once when
 * someone joins; `current` is read for every new connection and does no work.
 */
export interface VoiceIceProvider {
  /** Refresh and cache the list for the session about to start. Throws `IceConfigError`. */
  beginSession(): Promise<RTCIceServer[]>;
  /** The list cached by `beginSession`, for building a peer connection. */
  current(): RTCIceServer[];
  /** Drop the session cache so the next join refreshes again. */
  endSession(): void;
}

export interface RuntimeIceProviderOptions {
  /** Reads `rtc` from `/api/bootstrap`. */
  fetchRtc: () => Promise<RtcConfig | undefined>;
  /** `NEXT_PUBLIC_ICE_SERVERS`, a development-only fallback. */
  envServers: () => RTCIceServer[];
  isProduction: boolean;
  now?: () => number;
  marginMs?: number;
}

/**
 * Session-scoped ICE configuration, refreshed on every join.
 *
 * coturn credentials from `/api/bootstrap` last an hour, and a tab stays open
 * far longer. A client that kept the list from page load works all morning on
 * a network that reaches the media server directly, then silently loses the
 * ability to relay because the TURN credential died hours ago.
 *
 * So the list is refreshed when it is about to matter: at the start of a voice
 * session, before any connection exists. It is then frozen for that session,
 * so replacing the connection to the media server costs no fetch.
 */
export class RuntimeIceProvider implements VoiceIceProvider {
  /** Last successfully resolved list: the seed first, then each refresh. */
  private lastKnown: RTCIceServer[] = [];
  private session: RTCIceServer[] | null = null;

  constructor(private readonly options: RuntimeIceProviderOptions) {}

  /**
   * Adopt the config the app fetched during its own bootstrap, so a join a few
   * seconds after page load has something valid to fall back on.
   */
  seed(runtime?: readonly IceServerConfig[]): void {
    this.lastKnown = this.resolve(runtime);
  }

  async beginSession(): Promise<RTCIceServer[]> {
    try {
      const rtc = await this.options.fetchRtc();
      // Minted by the server a moment ago, so it is trusted as it is, even
      // when empty: that means this instance genuinely offers no ICE servers.
      const fresh = this.resolve(rtc?.iceServers);
      this.lastKnown = fresh;
      this.session = fresh;
      return fresh;
    } catch (cause) {
      if (cause instanceof IceConfigError) throw cause;

      const fallback = this.evaluate(this.lastKnown);
      if (!fallback.usable) {
        this.session = null;
        // `lastKnown` deliberately keeps the expired entry. Pruning it would
        // leave a STUN-only list, which counts as usable forever, so the next
        // retry would quietly succeed with no relay instead of reporting the
        // real problem. Nothing leaks, because `current()` prunes every read.
        const nothingCached = this.lastKnown.length === 0;
        throw new IceConfigError(
          nothingCached ? "unavailable" : "expired",
          nothingCached
            ? "No ICE configuration is available and the refresh failed"
            : "Cached TURN credentials have expired and the refresh failed",
        );
      }

      this.session = fallback.servers;
      return fallback.servers;
    }
  }

  current(): RTCIceServer[] {
    // The session can outlive a credential too, so every read prunes, whether
    // the source is the session or the bootstrap seed. A connection replaced
    // late in a call never receives a dead relay credential.
    const source = this.session ?? this.lastKnown;
    const { servers } = this.evaluate(source);
    return servers.length === source.length ? source : servers;
  }

  endSession(): void {
    this.session = null;
  }

  private resolve(runtime: readonly IceServerConfig[] | undefined): RTCIceServer[] {
    return resolveIceServers({
      runtime,
      env: this.options.envServers(),
      isProduction: this.options.isProduction,
    });
  }

  private evaluate(servers: readonly RTCIceServer[]): IceFallbackDecision {
    return evaluateIceFallback(
      servers,
      (this.options.now ?? Date.now)(),
      this.options.marginMs ?? TURN_SAFETY_MARGIN_MS,
    );
  }
}

/** A fixed list, for tests and any transport that needs no refresh. */
export class StaticIceProvider implements VoiceIceProvider {
  constructor(private readonly servers: RTCIceServer[] = []) {}

  async beginSession(): Promise<RTCIceServer[]> {
    return this.servers;
  }

  current(): RTCIceServer[] {
    return this.servers;
  }

  endSession(): void {}
}
