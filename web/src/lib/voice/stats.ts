import type { NetworkSample } from "./bitrate";

/**
 * Turns an `RTCStatsReport` into the numbers the bitrate controller and the
 * health checks need.
 *
 * Loss comes from `remote-inbound-rtp`, the receiver telling us what actually
 * arrived, which is the only honest source for it. RTT comes from there too,
 * with `candidate-pair` as the fallback because it is populated as soon as ICE
 * settles, well before the first RTCP receiver report.
 *
 * Reports are iterated rather than indexed, so any stats-report-like object
 * works, which is also what makes this testable without a browser.
 */
export interface StatsEntry {
  type?: string;
  kind?: string;
  mediaType?: string;
  fractionLost?: number;
  packetsSent?: number;
  packetsReceived?: number;
  bytesSent?: number;
  bytesReceived?: number;
  roundTripTime?: number;
  currentRoundTripTime?: number;
  state?: string;
  nominated?: boolean;
  [key: string]: unknown;
}

export type StatsLike = Iterable<StatsEntry> | { forEach(fn: (entry: StatsEntry) => void): void };

export interface MediaCounters {
  bytesSent: number;
  bytesReceived: number;
  packetsSent: number;
  packetsReceived: number;
}

/**
 * `forEach` is preferred because iterating a real `RTCStatsReport` yields
 * `[id, entry]` pairs, while `forEach` hands over the entries themselves.
 */
function entriesOf(report: StatsLike): StatsEntry[] {
  const entries: StatsEntry[] = [];
  if ("forEach" in report && typeof report.forEach === "function") {
    report.forEach((entry) => entries.push(entry));
  } else {
    for (const entry of report as Iterable<StatsEntry>) entries.push(entry);
  }
  return entries;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A cumulative counter: anything that is not a positive finite number is zero. */
function counter(value: unknown): number {
  const number = finite(value);
  return number !== null && number > 0 ? number : 0;
}

export function summariseStats(report: StatsLike): NetworkSample | null {
  let loss: number | null = null;
  let receiverRtt: number | null = null;
  let pairRtt: number | null = null;

  for (const entry of entriesOf(report)) {
    if (entry.type === "remote-inbound-rtp" && (entry.kind ?? "audio") === "audio") {
      const fractionLost = finite(entry.fractionLost);
      if (fractionLost !== null) loss = Math.min(1, Math.max(0, fractionLost));
      const roundTripTime = finite(entry.roundTripTime);
      if (roundTripTime !== null) receiverRtt = roundTripTime * 1000;
    } else if (entry.type === "candidate-pair") {
      // Only the pair actually carrying media says anything about the link.
      const carrying = entry.nominated === true || entry.state === "succeeded";
      const roundTripTime = finite(entry.currentRoundTripTime);
      if (carrying && roundTripTime !== null) pairRtt = roundTripTime * 1000;
    }
  }

  const rttMs = receiverRtt ?? pairRtt;
  if (loss === null && rttMs === null) return null;
  return { lossFraction: loss ?? 0, rttMs: rttMs ?? 0 };
}

/**
 * Cumulative audio RTP counters, used to prove that a connected ICE/DTLS
 * transport is actually carrying media. Screen audio is included on purpose: it
 * is real RTP, and it keeps a healthy presentation from being labelled silent
 * merely because the speaker muted their microphone.
 */
export function summariseMediaCounters(report: StatsLike): MediaCounters | null {
  const totals: MediaCounters = {
    bytesSent: 0,
    bytesReceived: 0,
    packetsSent: 0,
    packetsReceived: 0,
  };
  let found = false;

  for (const entry of entriesOf(report)) {
    if ((entry.kind ?? entry.mediaType) !== "audio") continue;

    if (entry.type === "outbound-rtp") {
      found = true;
      totals.bytesSent += counter(entry.bytesSent);
      totals.packetsSent += counter(entry.packetsSent);
    } else if (entry.type === "inbound-rtp") {
      found = true;
      totals.bytesReceived += counter(entry.bytesReceived);
      totals.packetsReceived += counter(entry.packetsReceived);
    }
  }

  return found ? totals : null;
}

/**
 * Cumulative audio packets received on each receiving section, by `mid`.
 * Behind a media server one connection carries everybody, so the link's total
 * says nothing about one person; the section their microphone arrives on does.
 */
export function receivedAudioByMid(report: StatsLike): Map<string, number> {
  const byMid = new Map<string, number>();
  for (const entry of entriesOf(report)) {
    if (entry.type !== "inbound-rtp" || (entry.kind ?? entry.mediaType) !== "audio") continue;
    const { mid } = entry;
    if (typeof mid !== "string") continue;
    byMid.set(mid, (byMid.get(mid) ?? 0) + counter(entry.packetsReceived));
  }
  return byMid;
}

/** Worst of several readings: the call is only as good as its weakest one. */
export function worstSample(samples: readonly NetworkSample[]): NetworkSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((worst, sample) => ({
    lossFraction: Math.max(worst.lossFraction, sample.lossFraction),
    rttMs: Math.max(worst.rttMs, sample.rttMs),
  }));
}
