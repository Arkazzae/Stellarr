/**
 * Opus tuning for the browser's built-in encoder.
 *
 * The codec itself is not touched. The browser is told how to run it through
 * the only two levers WebRTC exposes: fmtp parameters in the SDP and
 * `RTCRtpSender.setParameters`.
 *
 * The parameters go into our **local** description, which states what we are
 * willing to *receive*, and that is what steers the remote encoder: `usedtx=0`
 * stops an encoder-side silence decision from eating an onset, `useinbandfec`
 * lets it repair a lost packet from the next one, and `maxaveragebitrate` caps
 * what it aims for. Our own outbound rate is capped separately.
 *
 * Every function here is total. Given SDP it cannot parse, or SDP without Opus,
 * it returns the input unchanged, because malformed SDP makes
 * `setLocalDescription` fail the whole call.
 */

/** Premium mono speech: ample full-band headroom without paying for stereo. */
export const OPUS_TARGET_BITRATE = 128_000;

export const OPUS_FMTP_PARAMETERS: Readonly<Record<string, string>> = Object.freeze({
  useinbandfec: "1",
  usedtx: "0",
  maxaveragebitrate: String(OPUS_TARGET_BITRATE),
  stereo: "0",
  "sprop-stereo": "0",
  minptime: "10",
});

/** 20 ms packets: the Opus default and the best latency/overhead trade for speech. */
export const OPUS_PTIME = 20;

interface ParsedSdp {
  lines: string[];
  newline: string;
  trailingNewline: boolean;
}

function parseSdp(sdp: string): ParsedSdp {
  const lines = sdp.split(/\r\n|\r|\n/);
  const trailingNewline = lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();
  return { lines, newline: sdp.includes("\r\n") ? "\r\n" : "\n", trailingNewline };
}

function serialiseSdp({ lines, newline, trailingNewline }: ParsedSdp): string {
  return lines.join(newline) + (trailingNewline ? newline : "");
}

/**
 * Runs an in-place edit over the lines of an SDP. The edit reports whether it
 * changed anything; when it did not, the original string comes back untouched.
 */
function editSdp(
  sdp: string | undefined | null,
  edit: (lines: string[]) => boolean,
): string {
  if (typeof sdp !== "string" || sdp.length === 0) return "";
  try {
    const parsed = parseSdp(sdp);
    return edit(parsed.lines) ? serialiseSdp(parsed) : sdp;
  } catch {
    return sdp;
  }
}

export interface MediaSection {
  kind: string;
  /** `a=mid:` value, the only stable way to tie a section to a transceiver. */
  mid: string | null;
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Every media section in declaration order.
 *
 * A call with a microphone and shared screen audio has two audio sections that
 * need different Opus settings, mono speech versus stereo content, so "the
 * first audio m-line" is never a safe assumption.
 */
export function mediaSections(lines: readonly string[]): MediaSection[] {
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith("m=")) starts.push(index);
  });

  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    const mLine = lines[start] ?? "";
    const midLine = lines.slice(start + 1, end).find((line) => line.startsWith("a=mid:"));
    return {
      kind: mLine.slice(2).split(" ")[0] ?? "",
      mid: midLine === undefined ? null : midLine.slice("a=mid:".length).trim(),
      start,
      end,
    };
  });
}

const OPUS_RTPMAP = /^a=rtpmap:(\d+)\s+opus\/\d+(?:\/\d+)?\s*$/i;

/** Payload types mapped to Opus in these lines, in declaration order. */
function opusPayloadTypes(lines: readonly string[]): string[] {
  return lines.flatMap((line) => {
    const payload = OPUS_RTPMAP.exec(line)?.[1];
    return payload === undefined ? [] : [payload];
  });
}

/**
 * Merge `k=v` pairs into an fmtp parameter list.
 *
 * Existing keys keep their position and are overwritten. Parameters the
 * browser added that we know nothing about (`sprop-maxcapturerate`, `cbr`, ...)
 * are preserved, and the order is stable so output is byte-comparable.
 */
export function mergeFmtpParameters(
  existing: string,
  updates: Readonly<Record<string, string>>,
): string {
  // A Map keeps first-insertion order when a key is overwritten.
  const merged = new Map<string, string>();
  for (const part of existing.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    merged.set(
      eq === -1 ? trimmed : trimmed.slice(0, eq),
      eq === -1 ? "" : trimmed.slice(eq + 1),
    );
  }
  for (const [key, value] of Object.entries(updates)) merged.set(key, value);

  return [...merged]
    .map(([key, value]) => (value === "" ? key : `${key}=${value}`))
    .join(";");
}

/** What one audio section should be tuned to. */
export interface AudioSectionTuning {
  parameters: Readonly<Record<string, string>>;
  ptime: number;
}

/**
 * Chooses the tuning for a section; null leaves it alone.
 *
 * The caller knows which transceiver carries the microphone and which carries
 * shared screen audio, so it resolves by `mid`, the only identifier that
 * survives renegotiation.
 */
export type AudioTuningResolver = (
  section: MediaSection,
  audioIndex: number,
) => AudioSectionTuning | null;

/** Returns the section's lines with every Opus payload tuned; null if it has no Opus. */
function tuneSection(
  section: readonly string[],
  { parameters, ptime }: AudioSectionTuning,
): string[] | null {
  const opus = new Set(opusPayloadTypes(section));
  if (opus.size === 0) return null;

  const tuned: string[] = [];
  const seenFmtp = new Set<string>();
  for (const line of section) {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);
    const payload = fmtp?.[1];
    if (payload !== undefined && opus.has(payload)) {
      seenFmtp.add(payload);
      tuned.push(`a=fmtp:${payload} ${mergeFmtpParameters(fmtp?.[2] ?? "", parameters)}`);
    } else {
      tuned.push(line);
    }
  }

  // A payload with no fmtp line gets one directly after its rtpmap, where
  // parsers expect it.
  for (const payload of opus) {
    if (seenFmtp.has(payload)) continue;
    const at = tuned.findIndex((line) => line.startsWith(`a=rtpmap:${payload} `));
    // The Opus pattern tolerates other whitespace than a single space.
    if (at === -1) continue;
    tuned.splice(at + 1, 0, `a=fmtp:${payload} ${mergeFmtpParameters("", parameters)}`);
  }

  // `a=ptime` is a section attribute, not an fmtp parameter.
  const ptimeLine = `a=ptime:${ptime}`;
  const existing = tuned.findIndex((line) => line.startsWith("a=ptime:"));
  if (existing !== -1) {
    tuned[existing] = ptimeLine;
  } else {
    const anchor = tuned.findIndex((line) => line.startsWith("a=fmtp:"));
    tuned.splice(Math.max(anchor, 0) + 1, 0, ptimeLine);
  }
  return tuned;
}

/**
 * Tune every audio section the resolver claims.
 *
 * Replacements are computed against the original lines and applied last to
 * first, so growing one section never shifts the bounds of another.
 */
export function tuneAudioSections(
  sdp: string | undefined | null,
  resolve: AudioTuningResolver,
): string {
  return editSdp(sdp, (lines) => {
    const audio = mediaSections(lines).filter((section) => section.kind === "audio");
    const replacements = audio.flatMap((section, audioIndex) => {
      const tuning = resolve(section, audioIndex);
      const tuned = tuning && tuneSection(lines.slice(section.start, section.end), tuning);
      return tuned ? [{ section, tuned }] : [];
    });

    for (const { section, tuned } of replacements.reverse()) {
      lines.splice(section.start, section.end - section.start, ...tuned);
    }
    return replacements.length > 0;
  });
}

/** Apply one set of Opus parameters to every audio section of an SDP. */
export function tuneOpusSdp(
  sdp: string | undefined | null,
  parameters: Readonly<Record<string, string>> = OPUS_FMTP_PARAMETERS,
  ptime: number = OPUS_PTIME,
): string {
  return tuneAudioSections(sdp, () => ({ parameters, ptime }));
}

/**
 * Move Opus to the front of every audio m-line's payload list.
 *
 * Used where `setCodecPreferences` is unavailable. It reorders and never
 * removes: dropping `telephone-event` or CN upsets some stacks.
 */
export function preferOpusInSdp(sdp: string | undefined | null): string {
  return editSdp(sdp, (lines) => {
    let changed = false;
    for (const section of mediaSections(lines)) {
      if (section.kind !== "audio") continue;

      const opus = opusPayloadTypes(lines.slice(section.start, section.end));
      // m=audio <port> <proto> <pt> <pt> ...
      const [media, port, proto, ...payloads] = (lines[section.start] ?? "").split(" ");
      if (opus.length === 0 || payloads.length === 0) continue;

      const promoted = [
        ...opus.filter((payload) => payloads.includes(payload)),
        ...payloads.filter((payload) => !opus.includes(payload)),
      ];
      const reordered = [media, port, proto, ...promoted].join(" ");
      if (reordered !== lines[section.start]) {
        lines[section.start] = reordered;
        changed = true;
      }
    }
    return changed;
  });
}

/**
 * How each audio section of a local description should be tuned.
 *
 * `byMid` is authoritative, since the caller knows which transceiver carries
 * the microphone and which carries screen audio. `fallback` covers a section
 * whose mid is not assigned yet, as on the very first offer.
 */
export interface AudioTuningPlan {
  byMid?: ReadonlyMap<string, AudioSectionTuning>;
  /**
   * Asked about a section `byMid` does not name, with the section's mid and
   * the stream id of its `a=msid`, before `fallback` is used. A transceiver
   * has no mid until the offer that first carries it is applied, so on that
   * offer its stream is the only thing that tells which section is which.
   */
  bySection?: (mid: string | null, streamId: string | null) => AudioSectionTuning | null;
  fallback: AudioSectionTuning;
}

const DEFAULT_PLAN: AudioTuningPlan = {
  fallback: { parameters: OPUS_FMTP_PARAMETERS, ptime: OPUS_PTIME },
};

/** Applies both transformations, in the order they must run. */
export function tuneLocalDescription(
  description: RTCSessionDescriptionInit,
  plan: AudioTuningPlan = DEFAULT_PLAN,
): RTCSessionDescriptionInit {
  if (!description.sdp) return description;

  const promoted = preferOpusInSdp(description.sdp);
  const streams = plan.bySection ? audioSectionStreamIds(promoted) : [];
  const sdp = tuneAudioSections(promoted, ({ mid }, audioIndex) => {
    const tuning = mid === null ? undefined : plan.byMid?.get(mid);
    return tuning ?? plan.bySection?.(mid, streams[audioIndex] ?? null) ?? plan.fallback;
  });
  return sdp === description.sdp ? description : { ...description, sdp };
}

/** The `a=msid` stream id of every audio section in order, null where it names none. */
function audioSectionStreamIds(sdp: string): Array<string | null> {
  const { lines } = parseSdp(sdp);
  return mediaSections(lines)
    .filter((section) => section.kind === "audio")
    .map((section) => {
      for (const line of lines.slice(section.start, section.end)) {
        const id = (MSID_LINE.exec(line) ?? SSRC_MSID_LINE.exec(line))?.[1];
        if (id !== undefined) return id === "-" ? null : id;
      }
      return null;
    });
}

/**
 * Codec order for a shared screen.
 *
 * VP9 first: it handles the large flat areas and sharp text of a desktop far
 * better than VP8 at the same bitrate, and every Chromium build has it. AV1 is
 * better still where hardware allows but is not universally cheap to encode, so
 * it sits second. Nothing is ever removed, because dropping H.264 or the
 * RTX/FEC entries would break interop with a browser that has nothing else.
 */
export const SCREEN_CODEC_PREFERENCE = ["VP9", "AV1", "VP8", "H264"] as const;

export function screenVideoCodecList(
  codecs: readonly RTCRtpCodec[] | undefined,
): RTCRtpCodec[] | null {
  if (!codecs || codecs.length === 0) return null;

  const unranked = SCREEN_CODEC_PREFERENCE.length;
  const rank = ({ mimeType }: RTCRtpCodec): number => {
    const name = mimeType.split("/")[1]?.toUpperCase();
    const index = SCREEN_CODEC_PREFERENCE.findIndex((preferred) => preferred === name);
    return index === -1 ? unranked : index;
  };

  // Nothing recognised: the browser's own order stands.
  if (codecs.every((codec) => rank(codec) === unranked)) return null;
  // `sort` is stable, so equally ranked codecs keep their relative order.
  return [...codecs].sort((a, b) => rank(a) - rank(b));
}

/**
 * Reorder a receiver's codec list so Opus is offered first.
 *
 * Null when the browser reports no capabilities or no Opus, so the caller can
 * fall back to reordering the m-line by hand.
 */
export function opusFirstCodecList(
  codecs: readonly RTCRtpCodec[] | undefined,
): RTCRtpCodec[] | null {
  if (!codecs) return null;
  const isOpus = ({ mimeType }: RTCRtpCodec) => /\/opus$/i.test(mimeType);
  if (!codecs.some(isOpus)) return null;
  return [...codecs.filter(isOpus), ...codecs.filter((codec) => !isOpus(codec))];
}

const MSID_LINE = /^a=msid:(\S+)/;
const SSRC_MSID_LINE = /^a=ssrc:\d+\s+msid:(\S+)/;

/**
 * Stream ids (msid) that carry video in this description.
 *
 * This makes remote-track classification order-independent. A screen share is
 * the only thing that sends video, so any audio track whose msid also appears
 * on a video section belongs to that share. That is knowable from the SDP
 * alone, before a single track event fires and without waiting for the peer's
 * own announcement. Both spellings are read: the unified-plan `a=msid:` line
 * and the older per-ssrc form.
 */
export function videoStreamIds(sdp: string | undefined | null): Set<string> {
  const ids = new Set<string>();
  if (typeof sdp !== "string" || sdp.length === 0) return ids;

  const { lines } = parseSdp(sdp);
  for (const section of mediaSections(lines)) {
    if (section.kind !== "video") continue;
    for (const line of lines.slice(section.start, section.end)) {
      const id = (MSID_LINE.exec(line) ?? SSRC_MSID_LINE.exec(line))?.[1];
      // `-` is the placeholder for "no stream", not a stream called "-".
      if (id !== undefined && id !== "-") ids.add(id);
    }
  }
  return ids;
}
