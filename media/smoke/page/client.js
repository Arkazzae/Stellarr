// The smallest client of Stellarr Media that keeps the "Negotiation rules" of
// docs/stellarr-media.md: one RTCPeerConnection with max-bundle, the browser
// offers what it publishes and answers what the media server offers, it is
// the impolite side of a collision, and every arriving track is filed under
// the person the directory names.
//
// The Node script plays the hub. It calls the functions on `window.smoke` and
// hands every event of this page's session to `smoke.signal`; the page sends
// its own signals through `window.hubSend`, which Node exposes.

"use strict";

/** The Opus parameters the web client writes into its local descriptions. */
const OPUS_TUNING = {
  useinbandfec: "1",
  usedtx: "0",
  maxaveragebitrate: "128000",
  stereo: "0",
  "sprop-stereo": "0",
  minptime: "10",
};

/** The screen audio profile of docs/rtc-and-ports.md: 160 kb/s in stereo. */
const SCREEN_AUDIO_TUNING = {
  ...OPUS_TUNING,
  maxaveragebitrate: "160000",
  stereo: "1",
  "sprop-stereo": "1",
};

const state = {
  pc: null,
  sessionId: null,
  sent: 0,
  tuneOpus: false,
  // Streams whose audio is tuned as screen audio rather than as a microphone.
  stereoStreams: new Set(),
  // Every negotiation step, incoming signal and outgoing offer runs on this
  // one chain. Whether to ignore an offer is decided when it is processed, so
  // an offer that follows an answer is never judged by a state the answer is
  // about to change.
  chain: Promise.resolve(),
  directory: [],
  directoryLog: [],
  offersIgnored: [],
  offersAnswered: [],
  answersApplied: 0,
  negotiationNeeded: 0,
  arrivals: [],
  published: {},
  descriptions: [],
  errors: [],
  closed: null,
  audio: null,
};

function run(task) {
  const result = state.chain.then(task);
  state.chain = result.catch((error) => {
    state.errors.push(String((error && error.stack) || error));
  });
  return result;
}

function send(kind, payload) {
  // The number lets the hub check that signals reach it in the order they
  // were sent.
  state.sent += 1;
  window.hubSend(state.sessionId, state.sent, kind, payload);
}

function record(side, type, sdp, extra = {}) {
  state.descriptions.push({ at: performance.now(), side, type, sdp, ...extra });
}

function setDirectory(source, tracks) {
  state.directory = tracks;
  state.directoryLog.push({ at: performance.now(), source, tracks });
}

/**
 * What `tuneLocalDescription` of the web client does to an audio section:
 * Opus first in the payload list, the Opus fmtp parameters merged in and a
 * 20 ms packet time.
 */
function tuneSection(section) {
  if (!section.startsWith("m=audio")) return section;
  const trailing = section.endsWith("\r\n");
  const lines = section.replace(/\r\n$/, "").split("\r\n");
  const opus = new Set();
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) opus\//i.exec(line);
    if (match) opus.add(match[1]);
  }
  if (opus.size === 0) return section;

  const msid = lines.find((line) => line.startsWith("a=msid:"));
  const stream = msid ? msid.slice("a=msid:".length).split(" ")[0] : null;
  const tuning = state.stereoStreams.has(stream) ? SCREEN_AUDIO_TUNING : OPUS_TUNING;

  const [media, port, proto, ...pts] = lines[0].split(" ");
  const ordered = [...pts.filter((p) => opus.has(p)), ...pts.filter((p) => !opus.has(p))];
  lines[0] = [media, port, proto, ...ordered].join(" ");

  let lastFmtp = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(lines[i]);
    if (!fmtp || !opus.has(fmtp[1])) continue;
    const merged = new Map();
    for (const part of fmtp[2].split(";")) {
      const [key, value = ""] = part.trim().split("=");
      if (key) merged.set(key, value);
    }
    for (const [key, value] of Object.entries(tuning)) merged.set(key, value);
    const params = [...merged].map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join(";");
    lines[i] = `a=fmtp:${fmtp[1]} ${params}`;
    lastFmtp = i;
  }

  const ptime = lines.findIndex((line) => line.startsWith("a=ptime:"));
  if (ptime !== -1) lines[ptime] = "a=ptime:20";
  else lines.splice(lastFmtp === -1 ? lines.length : lastFmtp + 1, 0, "a=ptime:20");

  return lines.join("\r\n") + (trailing ? "\r\n" : "");
}

function tuneOpus(sdp) {
  if (!state.tuneOpus) return sdp;
  const [session, ...sections] = sdp.split(/\r\n(?=m=)/);
  return [session, ...sections.map(tuneSection)].join("\r\n");
}

function stable() {
  const pc = state.pc;
  if (pc.signalingState === "stable" || pc.signalingState === "closed") return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.signalingState === "stable" || pc.signalingState === "closed") {
        pc.removeEventListener("signalingstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("signalingstatechange", check);
  });
}

/** Offers what this page publishes, as soon as no offer of its own is open. */
async function negotiate() {
  for (;;) {
    await stable();
    const sent = await run(async () => {
      if (state.pc.signalingState !== "stable") return false;
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription({ type: "offer", sdp: tuneOpus(offer.sdp) });
      const sdp = state.pc.localDescription.sdp;
      record("local", "offer", sdp);
      send("offer", { type: "offer", sdp });
      return true;
    });
    if (sent) return;
  }
}

async function handle(event) {
  // A signal or a closure that names another session is dropped.
  if (event.sessionId !== state.sessionId) return;
  if (event.type === "closed") {
    state.closed = event.reason;
    return;
  }

  const pc = state.pc;
  const payload = event.payload;
  switch (event.kind) {
    case "answer": {
      if (pc.signalingState !== "have-local-offer") {
        throw new Error(`an answer arrived in ${pc.signalingState}`);
      }
      record("remote", "answer", payload.sdp);
      await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      state.answersApplied += 1;
      return;
    }
    case "offer": {
      // Impolite: an offer of the media server that meets one of ours being
      // made or waiting for its answer is ignored. The media server rolls
      // its own back and offers again after answering ours.
      if (pc.signalingState !== "stable") {
        state.offersIgnored.push(payload.negotiationId);
        record("remote", "offer-ignored", payload.sdp, { negotiationId: payload.negotiationId });
        return;
      }
      // The directory comes with the offer, so it is in hand before any
      // track of the offer arrives.
      setDirectory("offer", payload.tracks);
      record("remote", "offer", payload.sdp, { negotiationId: payload.negotiationId });
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({ type: "answer", sdp: tuneOpus(answer.sdp) });
      const sdp = pc.localDescription.sdp;
      record("local", "answer", sdp, { negotiationId: payload.negotiationId });
      send("answer", { type: "answer", sdp, negotiationId: payload.negotiationId });
      state.offersAnswered.push(payload.negotiationId);
      return;
    }
    case "tracks":
      setDirectory("tracks", payload.tracks);
      return;
    default:
      throw new Error(`unknown signal ${event.kind}`);
  }
}

function audioContext() {
  if (!state.audio) state.audio = new AudioContext();
  state.audio.resume().catch(() => {});
  return state.audio;
}

/** Plays a remote track muted, so it is decoded, and taps audio for its tone. */
function attach(arrival) {
  const stream = new MediaStream([arrival.track]);
  const element = document.createElement(arrival.kind === "video" ? "video" : "audio");
  element.muted = true;
  element.autoplay = true;
  element.playsInline = true;
  element.srcObject = stream;
  document.body.append(element);
  element.play().catch(() => {});
  arrival.element = element;

  if (arrival.kind === "audio") {
    const ctx = audioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.3;
    ctx.createMediaStreamSource(stream).connect(analyser);
    arrival.analyser = analyser;
  }
}

function onTrack(event) {
  const mid = event.transceiver.mid;
  const entry = state.directory.find((t) => t.mid === mid);
  const arrival = {
    at: performance.now(),
    mid,
    kind: event.track.kind,
    trackId: event.track.id,
    streams: event.streams.map((s) => s.id),
    signalingState: state.pc.signalingState,
    directoryKnown: Boolean(entry),
    directoryUserId: entry ? entry.userId : null,
    mutedAtArrival: event.track.muted,
    events: [],
    track: event.track,
  };
  for (const name of ["mute", "unmute", "ended"]) {
    event.track.addEventListener(name, () => {
      arrival.events.push({ name, at: performance.now() });
    });
  }
  attach(arrival);
  state.arrivals.push(arrival);
}

async function start({ sessionId, tuneOpus: tune = false }) {
  state.sessionId = sessionId;
  state.tuneOpus = tune;
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
  state.pc = pc;
  pc.addEventListener("track", onTrack);
  pc.addEventListener("icecandidate", (event) => {
    send("candidate", event.candidate ? event.candidate.toJSON() : null);
  });
  pc.addEventListener("negotiationneeded", () => {
    state.negotiationNeeded += 1;
  });
  return { isSecureContext: window.isSecureContext };
}

async function capture(kind) {
  const constraints =
    kind === "audio"
      ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
      : { video: { width: 320, height: 240, frameRate: 30 } };
  return navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Publishes the fake microphone or camera. `via` is "transceiver" for
 * addTransceiver(track, { direction: "sendonly", streams }) or "addTrack";
 * `codec` is put first in the codec preferences, `scalabilityMode` is asked
 * of the encoder, and `stereo` tunes an audio track as screen audio.
 */
async function publish(name, kind, { via = "transceiver", codec, scalabilityMode, stereo } = {}) {
  const stream = await capture(kind);
  if (stereo) state.stereoStreams.add(stream.id);
  const track = stream.getTracks()[0];
  let transceiver;
  if (via === "addTrack") {
    const sender = state.pc.addTrack(track, stream);
    transceiver = state.pc.getTransceivers().find((t) => t.sender === sender);
  } else {
    const init = { direction: "sendonly", streams: [stream] };
    if (scalabilityMode) init.sendEncodings = [{ scalabilityMode }];
    transceiver = state.pc.addTransceiver(track, init);
  }
  if (codec) {
    // The codec is moved to the front and nothing is removed, as the screen
    // share of the web client does.
    const all = RTCRtpReceiver.getCapabilities(kind).codecs;
    const wanted = (c) => c.mimeType.toLowerCase() === `${kind}/${codec}`.toLowerCase();
    transceiver.setCodecPreferences([...all.filter(wanted), ...all.filter((c) => !wanted(c))]);
  }
  state.published[name] = { transceiver, stream, track, kind };
  const reused = transceiver.mid !== null;
  await negotiate();
  return {
    streamId: stream.id,
    trackId: track.id,
    mid: transceiver.mid,
    reusedTransceiver: reused,
    direction: transceiver.direction,
  };
}

/**
 * Stops publishing: "remove" is removeTrack, which leaves the section
 * inactive, and "stop" is transceiver.stop(), which rejects it and lets the
 * browser recycle its m-line later.
 */
async function unpublish(name, how) {
  const published = state.published[name];
  if (how === "stop") published.transceiver.stop();
  else state.pc.removeTrack(published.transceiver.sender);
  published.track.stop();
  delete state.published[name];
  await negotiate();
  return { direction: published.transceiver.direction, mid: published.transceiver.mid };
}

/** Replaces a published camera with a new capture in a new stream. */
async function swap(name) {
  const published = state.published[name];
  const stream = await capture("video");
  const track = stream.getVideoTracks()[0];
  const sender = published.transceiver.sender;
  await sender.replaceTrack(track);
  sender.setStreams(stream);
  published.track.stop();
  published.track = track;
  published.stream = stream;
  await negotiate();
  return { streamId: stream.id, trackId: track.id, mid: published.transceiver.mid };
}

function snapshot() {
  const pc = state.pc;
  return {
    signalingState: pc.signalingState,
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    directory: state.directory,
    directoryLog: state.directoryLog,
    transceivers: pc.getTransceivers().map((t) => ({
      mid: t.mid,
      direction: t.direction,
      currentDirection: t.currentDirection,
      kind: t.receiver.track.kind,
      receiverTrackId: t.receiver.track.id,
      receiverMuted: t.receiver.track.muted,
      receiverReadyState: t.receiver.track.readyState,
      sending: t.sender.track !== null,
    })),
    arrivals: state.arrivals.map(({ track, element, analyser, ...rest }) => ({
      ...rest,
      muted: track.muted,
      readyState: track.readyState,
    })),
    offersIgnored: state.offersIgnored,
    offersAnswered: state.offersAnswered,
    answersApplied: state.answersApplied,
    negotiationNeeded: state.negotiationNeeded,
    errors: state.errors,
    closed: state.closed,
  };
}

async function stats() {
  const report = await state.pc.getStats();
  const codecs = {};
  report.forEach((s) => {
    if (s.type === "codec") codecs[s.id] = `${s.mimeType} ${s.sdpFmtpLine || ""}`.trim();
  });

  const inbound = {};
  const outbound = {};
  let pair = null;
  report.forEach((s) => {
    if (s.type === "inbound-rtp") {
      inbound[s.mid] = {
        kind: s.kind,
        ssrc: s.ssrc,
        codec: codecs[s.codecId] || null,
        packetsReceived: s.packetsReceived || 0,
        bytesReceived: s.bytesReceived || 0,
        packetsLost: s.packetsLost || 0,
        framesDecoded: s.framesDecoded || 0,
        keyFramesDecoded: s.keyFramesDecoded || 0,
        frameWidth: s.frameWidth || 0,
        nackCount: s.nackCount || 0,
        pliCount: s.pliCount || 0,
        firCount: s.firCount || 0,
        retransmittedPacketsReceived: s.retransmittedPacketsReceived || 0,
        freezeCount: s.freezeCount || 0,
      };
    }
    if (s.type === "outbound-rtp") {
      outbound[s.mid] = {
        kind: s.kind,
        ssrc: s.ssrc,
        codec: codecs[s.codecId] || null,
        packetsSent: s.packetsSent || 0,
        bytesSent: s.bytesSent || 0,
        framesEncoded: s.framesEncoded || 0,
        keyFramesEncoded: s.keyFramesEncoded || 0,
        pliCount: s.pliCount || 0,
        firCount: s.firCount || 0,
        nackCount: s.nackCount || 0,
        retransmittedPacketsSent: s.retransmittedPacketsSent || 0,
        targetBitrate: s.targetBitrate || 0,
        scalabilityMode: s.scalabilityMode || null,
      };
    }
    if (s.type === "transport" && s.selectedCandidatePairId) {
      const selected = report.get(s.selectedCandidatePairId);
      const local = selected && report.get(selected.localCandidateId);
      const remote = selected && report.get(selected.remoteCandidateId);
      const describe = (c) =>
        c && {
          address: c.address,
          port: c.port,
          protocol: c.protocol,
          candidateType: c.candidateType,
        };
      pair = selected && {
        state: selected.state,
        nominated: selected.nominated,
        local: describe(local),
        remote: describe(remote),
        availableOutgoingBitrate: selected.availableOutgoingBitrate || 0,
        dtlsState: s.dtlsState,
        dtlsRole: s.dtlsRole,
        iceRole: s.iceRole,
      };
    }
  });
  return { inbound, outbound, pair };
}

/**
 * The audio level each receiving audio section last carried, by mid. Chromium
 * fills it only from the ssrc-audio-level header extension, so a number here
 * proves the extension was forwarded.
 */
function levels() {
  const out = {};
  for (const transceiver of state.pc.getTransceivers()) {
    if (transceiver.receiver.track.kind !== "audio" || !transceiver.mid) continue;
    const sources = transceiver.receiver.getSynchronizationSources();
    out[transceiver.mid] = sources.map((source) => source.audioLevel ?? null);
  }
  return out;
}

/** Offers to receive only, as a client with nothing to publish must. */
async function receiveOnly(kind) {
  state.pc.addTransceiver(kind, { direction: "recvonly" });
  await negotiate();
}

/** The tone of every audio track and the colour of every video track, by mid. */
function measure() {
  const out = {};
  for (const arrival of state.arrivals) {
    if (arrival.kind === "audio") {
      const analyser = arrival.analyser;
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      let peak = 1;
      for (let i = 1; i < bins.length; i += 1) if (bins[i] > bins[peak]) peak = i;
      out[arrival.mid] = {
        kind: "audio",
        peakHz: (peak * state.audio.sampleRate) / analyser.fftSize,
        peakDb: bins[peak],
      };
    } else {
      const element = arrival.element;
      if (!element.videoWidth) {
        out[arrival.mid] = { kind: "video", rgb: null };
        continue;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(element, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) {
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
      }
      const pixels = data.length / 4;
      out[arrival.mid] = {
        kind: "video",
        rgb: sum.map((v) => Math.round(v / pixels)),
        width: element.videoWidth,
      };
    }
  }
  return out;
}

function close() {
  for (const published of Object.values(state.published)) published.track.stop();
  if (state.pc) state.pc.close();
}

window.smoke = {
  start,
  publish,
  unpublish,
  swap,
  signal: (event) => {
    run(() => handle(event));
  },
  receiveOnly,
  snapshot,
  stats,
  levels,
  measure,
  descriptions: () => state.descriptions,
  close,
};
