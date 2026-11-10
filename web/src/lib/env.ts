/**
 * ICE servers for instances that do not run coturn, read from a JSON array:
 *
 *   NEXT_PUBLIC_ICE_SERVERS='[{"urls":"stun:stun.example.org:3478"}]'
 *
 * The per-user TURN credentials in `/api/bootstrap` take precedence over these.
 * Anything that is not a JSON array yields no servers rather than an error.
 */
export function iceServers(): RTCIceServer[] {
  // Next replaces only the literal `process.env.NEXT_PUBLIC_*` expression at
  // build time, so the variable cannot be looked up by a computed name.
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : [];
  } catch {
    return [];
  }
}
