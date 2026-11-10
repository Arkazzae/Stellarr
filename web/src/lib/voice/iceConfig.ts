import type { IceServerConfig } from "@/lib/api/types";

export interface ResolveIceInput {
  /** `rtc.iceServers` from `/api/bootstrap`, with the per-user TURN credentials. */
  runtime?: readonly IceServerConfig[] | undefined;
  /** `NEXT_PUBLIC_ICE_SERVERS`, baked in at build time. */
  env?: readonly RTCIceServer[] | undefined;
  /** False only in development builds. */
  isProduction: boolean;
}

/**
 * Decides which ICE servers a peer connection gets.
 *
 * The runtime list from `/api/bootstrap` is authoritative. It carries coturn's
 * time-limited REST credentials, an HMAC over `<expiry>:<userId>` that is valid
 * for an hour and unique to the user, so it can be neither baked into a build
 * nor shared between people. A build-time list can hold STUN and nothing more.
 *
 * The env list is therefore a development convenience: it lets someone run the
 * UI against a STUN server with no backend. In production an empty runtime list
 * means the server really offered nothing. Substituting a stale build-time list
 * would hide that misconfiguration behind calls that fail only for people
 * behind symmetric NAT.
 */
export function resolveIceServers({
  runtime,
  env,
  isProduction,
}: ResolveIceInput): RTCIceServer[] {
  const fromRuntime = (runtime ?? []).flatMap(toRtcIceServer);
  if (fromRuntime.length > 0) return fromRuntime;
  if (isProduction) return [];
  return (env ?? []).map((server) => ({ ...server }));
}

/**
 * Converts one wire entry. `username` and `credential` pass through verbatim:
 * coturn recomputes the HMAC over the username, so trimming or re-casing either
 * half breaks authentication.
 *
 * An entry with no usable URL is dropped, because `RTCPeerConnection` throws on
 * a malformed `urls` value and that would take down the whole call.
 */
function toRtcIceServer({ urls, username, credential }: IceServerConfig): RTCIceServer[] {
  const usable = (Array.isArray(urls) ? urls : [urls]).filter(
    (url): url is string => typeof url === "string" && url !== "",
  );
  if (usable.length === 0) return [];

  // coturn rejects a username without its HMAC, and a lone credential means
  // nothing, so the pair is attached only when both halves are present.
  const hasCredentials = !!username && !!credential;
  return [hasCredentials ? { urls: usable, username, credential } : { urls: usable }];
}
