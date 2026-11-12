// Proves Stellarr Media against real browsers.
//
// The script starts the release binary on spare loopback ports, plays the
// hub between it and headless Chromium pages, and runs one scenario per
// behaviour of docs/stellarr-media.md that a str0m client cannot show. Every
// claim about media is read from getStats() or from the decoded media itself,
// never from a connection state.
//
//   node smoke.mjs            every scenario
//   node smoke.mjs a e        only these
//
// It prints one PASS or FAIL line per scenario and exits non-zero when any
// failed. The media server log, the descriptions every page exchanged and the
// numbers behind each line are written to the output directory it names.

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client, browserPath, launch, servePage } from "./lib/browser.mjs";
import { nearestColour, nearestTone, writeFixtures } from "./lib/fixtures.mjs";
import { Hub, startMedia } from "./lib/media.mjs";
import { LossyNat } from "./lib/nat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class Failure extends Error {}

function check(condition, message) {
  if (!condition) throw new Failure(message);
}

async function waitFor(what, probe, timeout = 15_000, interval = 200) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > end) throw new Failure(`timed out after ${timeout} ms waiting for ${what}`);
    await sleep(interval);
  }
}

// ------------------------------------------------------------------ checks

/** What `receiver` should receive: every publication of everybody else still in. */
function expectedTracks(receiver, clients) {
  return clients
    .filter((c) => c !== receiver && !c.left)
    .flatMap((c) => c.publications.map((p) => ({ publisher: c, publication: p })));
}

/**
 * Waits until the receiver's directory names every track it should receive,
 * each by its publisher's account and current stream id, and nothing else,
 * and every one of those sections is negotiated as receiving.
 */
async function directoryReady(receiver, clients) {
  return waitFor(`the directory of ${receiver.name}`, async () => {
    const snapshot = await receiver.snapshot();
    const wanted = expectedTracks(receiver, clients);
    if (snapshot.directory.length !== wanted.length) return null;
    const mapping = [];
    for (const w of wanted) {
      const entry = snapshot.directory.find(
        (t) =>
          t.userId === w.publisher.userId &&
          t.kind === w.publication.kind &&
          t.streamId === w.publication.streamId,
      );
      if (!entry) return null;
      const transceiver = snapshot.transceivers.find((t) => t.mid === entry.mid);
      if (!transceiver || transceiver.currentDirection !== "recvonly") return null;
      mapping.push({ ...w, mid: entry.mid });
    }
    return { mapping, snapshot };
  });
}

/** Waits until packets, and for video decoded frames, arrived on every section. */
async function firstMedia(receiver, mapping) {
  return waitFor(`media on every section of ${receiver.name}`, async () => {
    const stats = await receiver.stats();
    return mapping.every((m) => {
      const s = stats.inbound[m.mid];
      if (!s || s.packetsReceived === 0) return false;
      return m.publication.kind !== "video" || s.framesDecoded > 0;
    })
      ? stats
      : null;
  });
}

/**
 * Checks everything a seated person must see: the directory, packets and
 * frames advancing on every section, the right person's tone or colour on
 * each, nothing of its own, its own tracks going out, and the selected
 * candidate pair ending at the media server.
 */
async function verifyReceiver(env, receiver, clients) {
  const { mapping, snapshot } = await directoryReady(receiver, clients);
  check(
    snapshot.directory.every((t) => t.userId !== receiver.userId),
    `${receiver.name} has its own track in its directory`,
  );
  await firstMedia(receiver, mapping);

  const before = await receiver.stats();
  await sleep(1500);
  const after = await receiver.stats();
  const measured = await receiver.measure();

  const rows = mapping.map((m) => {
    const b = before.inbound[m.mid] ?? {};
    const a = after.inbound[m.mid] ?? {};
    const row = {
      from: m.publisher.name,
      track: m.publication.name,
      kind: m.publication.kind,
      mid: m.mid,
      packets: [b.packetsReceived ?? 0, a.packetsReceived ?? 0],
      codec: a.codec,
    };
    check(
      row.packets[1] > row.packets[0],
      `${receiver.name} mid ${m.mid} (${m.publisher.name} ${row.kind}): packets did not advance ${row.packets}`,
    );
    const media = measured[m.mid];
    if (row.kind === "video") {
      row.frames = [b.framesDecoded ?? 0, a.framesDecoded ?? 0];
      row.keyFrames = a.keyFramesDecoded;
      check(
        row.frames[1] > row.frames[0],
        `${receiver.name} mid ${m.mid}: frames did not advance ${row.frames}`,
      );
      const colour = media?.rgb ? nearestColour(media.rgb) : null;
      row.colour = media?.rgb;
      check(
        colour && colour.name === m.publisher.name && colour.distance < 100,
        `${receiver.name} mid ${m.mid}: the picture ${JSON.stringify(media?.rgb)} is not ${m.publisher.name}'s`,
      );
    } else {
      const tone = media ? nearestTone(media.peakHz) : null;
      row.toneHz = media && Math.round(media.peakHz);
      check(
        tone && tone.name === m.publisher.name && tone.error < 30 && media.peakDb > -90,
        `${receiver.name} mid ${m.mid}: the sound (${row.toneHz} Hz, ${media?.peakDb} dB) is not ${m.publisher.name}'s`,
      );
    }
    return row;
  });

  // Nothing arrives on a section the directory does not name, which is where
  // an own track would show up.
  const known = new Set(mapping.map((m) => m.mid));
  for (const [mid, b] of Object.entries(before.inbound)) {
    const a = after.inbound[mid];
    check(
      known.has(mid) || !a || a.packetsReceived === b.packetsReceived,
      `${receiver.name} receives packets on mid ${mid}, which its directory does not name`,
    );
  }

  const sending = receiver.publications.map((p) => {
    const b = before.outbound[p.mid] ?? {};
    const a = after.outbound[p.mid] ?? {};
    check(
      (a.packetsSent ?? 0) > (b.packetsSent ?? 0),
      `${receiver.name} does not send its ${p.name} (mid ${p.mid})`,
    );
    return {
      name: p.name,
      mid: p.mid,
      packetsSent: [b.packetsSent, a.packetsSent],
      kbps: Math.round(((a.bytesSent - b.bytesSent) * 8) / 1500),
      targetKbps: Math.round(a.targetBitrate / 1000),
      codec: a.codec,
    };
  });

  const pair = after.pair;
  check(pair, `${receiver.name} has no selected candidate pair`);
  const remote = `${pair.remote.address}:${pair.remote.port}`;
  check(
    remote === env.candidate,
    `${receiver.name}'s selected pair ends at ${remote}, not at the media server ${env.candidate}`,
  );

  return { name: receiver.name, rows, sending, pair };
}

async function verifyRoom(env, clients) {
  const live = clients.filter((c) => !c.left);
  return Promise.all(live.map((c) => verifyReceiver(env, c, clients)));
}

function summarise(results) {
  return results
    .map((r) => {
      const rows = r.rows
        .map((row) => {
          const what = row.kind === "video" ? `${row.frames[1]}f` : `${row.toneHz}Hz`;
          return `${row.from}.${row.kind[0]}@${row.mid}:${row.packets[1]}p/${what}`;
        })
        .join(" ");
      return `${r.name}<-[${rows}]`;
    })
    .join(" ");
}

// --------------------------------------------------------------- scenarios

class Scenario {
  constructor(env, id) {
    this.env = env;
    this.id = id;
    this.room = randomUUID();
    this.clients = [];
    this.allowIgnoredOffers = false;
    this.tolerated = new Set();
    this.logFrom = env.logText().length;
  }

  /** Seats a person. A tunes Opus in its descriptions like the web client. */
  async join(name, { mic = true, via } = {}) {
    const identity = this.env.identities.find((i) => i.name === name);
    const client = await Client.open({
      browser: this.env.browsers[name],
      url: this.env.url,
      hub: this.env.hub,
      identity,
      roomId: this.room,
      userId: randomUUID(),
      tuneOpus: name === "A",
    });
    this.clients.push(client);
    if (mic) await client.publish("mic", "audio", via ? { via } : {});
    return client;
  }

  sessionIds() {
    return new Set(this.clients.map((c) => c.sessionId));
  }

  log() {
    return this.env.logText().slice(this.logFrom);
  }

  /**
   * What must hold after any scenario, except for sessions the scenario
   * breaks on purpose and checks itself.
   */
  async verifyClean() {
    const ids = this.sessionIds();
    for (const id of this.tolerated) ids.delete(id);
    const hub = this.env.hub;
    const closed = hub.events.filter((e) => ids.has(e.sessionId) && e.type === "closed");
    check(closed.length === 0, `the media server closed sessions: ${JSON.stringify(closed)}`);
    const refused = hub.calls.filter((c) => ids.has(c.sessionId) && c.status !== 204);
    check(refused.length === 0, `control API calls failed: ${JSON.stringify(refused)}`);

    for (const client of this.clients) {
      if (this.tolerated.has(client.sessionId)) continue;
      check(client.pageErrors.length === 0, `${client.name}: ${client.pageErrors.join("; ")}`);
      if (client.left) continue;
      const snapshot = await client.snapshot();
      check(snapshot.errors.length === 0, `${client.name}: ${snapshot.errors.join("; ")}`);
      check(
        this.allowIgnoredOffers || snapshot.offersIgnored.length === 0,
        `${client.name} ignored offers ${snapshot.offersIgnored}`,
      );
    }

    // str0m's own warnings name no session, so every warning counts.
    const lines = this.log().split("\n");
    const mine = lines.filter((line) => [...ids].some((id) => line.includes(id)));
    const bad = [
      ...mine.filter((line) => /went unanswered|panicked|refused a|connection failed/.test(line)),
      ...lines
        .filter((line) => / (WARN|ERROR) /.test(line))
        .filter((line) => ![...this.tolerated].some((id) => line.includes(id))),
    ];
    check(bad.length === 0, `the media server log has: ${[...new Set(bad)].join(" | ")}`);
  }

  async dump() {
    for (const client of this.clients) {
      if (client.left && !client.savedDescriptions) continue;
      const descriptions = client.savedDescriptions ?? (await client.descriptions());
      writeFileSync(
        join(this.env.out, `${this.id}-${client.name}-descriptions.json`),
        JSON.stringify(descriptions, null, 2),
      );
    }
  }

  async cleanup() {
    for (const client of this.clients) await client.leave().catch(() => {});
  }
}

/** Saves a page's descriptions before it leaves, for the dump. */
async function leave(client) {
  client.savedDescriptions = await client.descriptions();
  await client.leave();
}

const SCENARIOS = {
  /** Two people with a fake microphone each hear each other and nothing of their own. */
  async a(s) {
    await s.join("A");
    await s.join("B");
    const results = await verifyRoom(s.env, s.clients);

    // The audio level header extension reaches the receivers.
    const levels = [];
    for (const r of results) {
      const client = s.clients.find((c) => c.name === r.name);
      const measured = await client.levels();
      for (const row of r.rows) {
        const level = measured[row.mid]?.[0];
        check(
          typeof level === "number" && level > 0,
          `${r.name} mid ${row.mid} carries no audio level`,
        );
        levels.push(`${r.name}@${row.mid} level ${level.toFixed(2)}`);
      }
    }
    return { summary: `${summarise(results)}; ${levels.join(", ")}`, results };
  },

  /**
   * A camera that has been running alone for seconds is decoded by a person
   * who arrives afterwards. Its encoder's own first keyframe is long gone, so
   * the picture starts only because the media server asked for a keyframe.
   */
  async b(s) {
    const A = await s.join("A");
    const camera = await A.publish("camera", "video");
    await sleep(4000);
    const alone = (await A.stats()).outbound[camera.mid];

    const joined = Date.now();
    const B = await s.join("B");
    const { mapping } = await directoryReady(B, s.clients);
    const mid = mapping.find((m) => m.publication.kind === "video").mid;
    await waitFor("B's first decoded frame", async () => {
      const stats = await B.stats();
      return stats.inbound[mid]?.framesDecoded > 0;
    });
    const firstFrameMs = Date.now() - joined;

    const results = await verifyRoom(s.env, s.clients);
    const received = (await B.stats()).inbound[mid];
    const sent = (await A.stats()).outbound[camera.mid];
    check(received.keyFramesDecoded >= 1, `B decoded no keyframe on ${mid}`);
    check(
      sent.pliCount + sent.firCount > alone.pliCount + alone.firCount,
      `A was not asked for a keyframe (PLI ${alone.pliCount} -> ${sent.pliCount}, FIR ${alone.firCount} -> ${sent.firCount})`,
    );
    check(
      sent.keyFramesEncoded > alone.keyFramesEncoded,
      `A encoded no keyframe after B arrived (${alone.keyFramesEncoded} -> ${sent.keyFramesEncoded})`,
    );
    return {
      summary:
        `first frame ${firstFrameMs} ms after joining; A PLI ${alone.pliCount}->${sent.pliCount}, ` +
        `keyframes encoded ${alone.keyFramesEncoded}->${sent.keyFramesEncoded}; ` +
        `B keyframes decoded ${received.keyFramesDecoded}, codec ${received.codec}; ${summarise(results)}`,
      results,
    };
  },

  /**
   * A third person arrives late and receives every existing track, each
   * filed under the person whose tone or colour it carries.
   */
  async c(s) {
    const A = await s.join("A");
    await A.publish("camera", "video");
    const B = await s.join("B");
    await B.publish("camera", "video");
    await verifyRoom(s.env, s.clients);
    await sleep(1000);

    const C = await s.join("C");
    const results = await verifyRoom(s.env, s.clients);
    const forC = results.find((r) => r.name === "C");
    check(forC.rows.length === 4, `C receives ${forC.rows.length} tracks instead of 4`);

    const snapshot = await C.snapshot();
    const late = snapshot.arrivals.filter((a) => !a.directoryKnown);
    check(
      late.length === 0,
      `C's tracks arrived before their directory entry: ${JSON.stringify(late)}`,
    );
    const arrivals = snapshot.arrivals.map((a) => ({
      mid: a.mid,
      kind: a.kind,
      streams: a.streams,
      streamIsPublishers: s.clients.some((c) =>
        c.publications.some((p) => a.streams.includes(p.streamId)),
      ),
      signalingState: a.signalingState,
      mutedAtArrival: a.mutedAtArrival,
      trackEvents: a.events.map((e) => e.name),
    }));
    return {
      summary:
        `${summarise([forC])}; ontrack ${JSON.stringify(arrivals)}; ` +
        `negotiationneeded fired ${snapshot.negotiationNeeded} times for 1 publication`,
      results,
      arrivals,
    };
  },

  /**
   * A person leaves: the others' sections of that person go inactive and the
   * directory shrinks. A later offer of a remaining browser leaves them so.
   */
  async d(s) {
    const A = await s.join("A");
    const B = await s.join("B");
    await B.publish("camera", "video");
    const C = await s.join("C");
    await verifyRoom(s.env, s.clients);

    const bMids = {};
    for (const r of [A, C]) {
      const snapshot = await r.snapshot();
      bMids[r.name] = snapshot.directory.filter((t) => t.userId === B.userId).map((t) => t.mid);
      check(bMids[r.name].length === 2, `${r.name} does not have both of B's tracks`);
    }

    await leave(B);
    const left = {};
    for (const r of [A, C]) {
      const snapshot = await waitFor(`${r.name}'s sections of B to go inactive`, async () => {
        const snap = await r.snapshot();
        const gone = snap.directory.every((t) => t.userId !== B.userId);
        const inactive = bMids[r.name].every(
          (mid) => snap.transceivers.find((t) => t.mid === mid)?.currentDirection === "inactive",
        );
        return gone && inactive ? snap : null;
      });
      const before = await r.stats();
      await sleep(1000);
      const after = await r.stats();
      for (const mid of bMids[r.name]) {
        const a = after.inbound[mid];
        const b = before.inbound[mid];
        // An inactive section's stats may go away or stand still.
        check(
          !a || (b && a.packetsReceived === b.packetsReceived),
          `${r.name} still receives on ${mid} after B left`,
        );
      }
      left[r.name] = bMids[r.name].map((mid) => {
        const t = snapshot.transceivers.find((x) => x.mid === mid);
        const arrival = snapshot.arrivals.find((x) => x.mid === mid);
        return {
          mid,
          direction: t.direction,
          currentDirection: t.currentDirection,
          muted: t.receiverMuted,
          readyState: t.receiverReadyState,
          trackEvents: arrival?.events.map((e) => e.name),
          statsAfter: after.inbound[mid] ? "present" : "absent",
        };
      });
    }
    await verifyRoom(s.env, s.clients);

    // A browser offer after the leave still lists those sections; they must
    // stay inactive and out of the directory.
    await A.publish("camera", "video");
    const results = await verifyRoom(s.env, s.clients);
    for (const r of [A, C]) {
      const snapshot = await r.snapshot();
      for (const mid of bMids[r.name]) {
        const t = snapshot.transceivers.find((x) => x.mid === mid);
        check(
          t.currentDirection === "inactive",
          `${r.name}'s section ${mid} of B is ${t.currentDirection} after A's offer`,
        );
      }
    }
    const offered = (await A.descriptions())
      .filter((d) => d.side === "local" && d.type === "offer")
      .pop()
      .sdp.split("\r\nm=")
      .filter((section) => bMids.A.some((mid) => section.includes(`a=mid:${mid}\r\n`)))
      .map((section) => section.match(/a=(sendrecv|sendonly|recvonly|inactive)/)?.[1]);
    return {
      summary:
        `after the leave ${JSON.stringify(left)}; ` +
        `A's next offer lists B's sections as ${offered}; ${summarise(results)}`,
      results,
      left,
      offeredDirections: offered,
    };
  },

  /**
   * A forced collision: the media server's offer is held back until the page
   * has an offer of its own outstanding. The page ignores the server's offer,
   * the media server rolls its own back, and both changes land.
   */
  async e(s) {
    s.allowIgnoredOffers = true;
    await s.join("A");
    const B = await s.join("B");
    const C = await s.join("C");
    await verifyRoom(s.env, s.clients);
    const hub = s.env.hub;

    hub.hold(C.sessionId);
    await B.publish("camera", "video");
    const held = await waitFor("the media server's offer to C", async () =>
      hub.heldEvents(C.sessionId).find((e) => e.kind === "offer"),
    );
    await C.publish("camera", "video");
    await hub.posted(C.sessionId);
    const offerCall = hub.callsOf(C.sessionId).filter((c) => c.kind === "offer").pop();
    check(offerCall.status === 204, `C's colliding offer got ${offerCall.status}`);
    await hub.release(C.sessionId);

    const results = await verifyRoom(s.env, s.clients);
    const snapshot = await C.snapshot();
    const heldId = held.payload.negotiationId;
    check(
      JSON.stringify(snapshot.offersIgnored) === JSON.stringify([heldId]),
      `C ignored ${JSON.stringify(snapshot.offersIgnored)}, not exactly offer ${heldId}`,
    );
    check(!snapshot.offersAnswered.includes(heldId), `C answered the ignored offer ${heldId}`);
    const later = snapshot.offersAnswered.filter((id) => id > heldId);
    check(later.length > 0, `C answered no offer after ${heldId}`);
    const rolledBack = s
      .log()
      .split("\n")
      .some((line) => line.includes("offer collision") && line.includes(C.sessionId));
    check(rolledBack, "the media server log shows no rollback for C");
    return {
      summary: `C ignored offer ${heldId}, answered ${later}; ${summarise(results)}`,
      results,
    };
  },

  /**
   * A publisher swaps its camera for a capture in a new stream: the others
   * get the new stream id in a tracks update, no offer, and keep the picture.
   */
  async f(s) {
    const A = await s.join("A");
    const camera = await A.publish("camera", "video");
    const B = await s.join("B");
    const C = await s.join("C");
    await verifyRoom(s.env, s.clients);
    const hub = s.env.hub;

    const before = {};
    for (const r of [B, C]) {
      const snapshot = await r.snapshot();
      before[r.name] = {
        mid: snapshot.directory.find((t) => t.userId === A.userId && t.kind === "video").mid,
        offers: hub.signalsOf(r.sessionId, "offer").length,
        tracks: hub.signalsOf(r.sessionId, "tracks").length,
      };
    }

    const swapped = await A.swap("camera");
    check(swapped.streamId !== camera.streamId, "the new capture has the old stream id");
    check(swapped.mid === camera.mid, "the swap moved the camera to another section");

    const after = {};
    for (const r of [B, C]) {
      await waitFor(`the new stream id at ${r.name}`, async () => {
        const snapshot = await r.snapshot();
        const entry = snapshot.directory.find((t) => t.mid === before[r.name].mid);
        return entry?.streamId === swapped.streamId;
      });
      after[r.name] = {
        offers: hub.signalsOf(r.sessionId, "offer").length - before[r.name].offers,
        tracks: hub.signalsOf(r.sessionId, "tracks").length - before[r.name].tracks,
      };
      check(
        after[r.name].offers === 0,
        `${r.name} got ${after[r.name].offers} offers for the swap`,
      );
      check(after[r.name].tracks >= 1, `${r.name} got no tracks update`);
    }

    const results = await verifyRoom(s.env, s.clients);
    const streams = {};
    for (const r of [B, C]) {
      const arrival = (await r.snapshot()).arrivals.find((a) => a.mid === before[r.name].mid);
      streams[r.name] = arrival.streams.map((id) => id.slice(0, 8));
    }
    for (const r of [B, C]) {
      const row = results
        .find((x) => x.name === r.name)
        .rows.find((x) => x.from === "A" && x.kind === "video");
      check(row.mid === before[r.name].mid, `${r.name} receives A's camera on another section`);
    }
    return {
      summary:
        `stream ${camera.streamId.slice(0, 8)} -> ${swapped.streamId.slice(0, 8)}; ` +
        `${JSON.stringify(after)}; the receivers' MediaStream ids stay ${JSON.stringify(streams)}; ` +
        summarise(results),
      results,
    };
  },

  /**
   * Every video codec of the contract travels: a publisher that prefers
   * VP9, H.264, AV1 or VP9 with temporal layers sends it, and a receiver
   * that numbers the codecs its own way decodes it.
   */
  async i(s) {
    const A = await s.join("A");
    const wanted = [
      { name: "vp9", codec: "VP9" },
      { name: "h264", codec: "H264" },
      { name: "av1", codec: "AV1" },
      { name: "vp9-l1t3", codec: "VP9", scalabilityMode: "L1T3" },
    ];
    for (const w of wanted) {
      await A.publish(w.name, "video", { codec: w.codec, scalabilityMode: w.scalabilityMode });
    }
    const B = await s.join("B");
    const results = await verifyRoom(s.env, s.clients);

    const sent = (await A.stats()).outbound;
    const received = results.find((r) => r.name === "B").rows;
    const codecs = wanted.map((w) => {
      const publication = A.publications.find((p) => p.name === w.name);
      const out = sent[publication.mid];
      const row = received.find((r) => r.from === "A" && r.track === w.name);
      check(
        out.codec?.startsWith(`video/${w.codec}`),
        `A sends ${out.codec} for ${w.name}, not ${w.codec}`,
      );
      check(
        row?.codec?.startsWith(`video/${w.codec}`),
        `B decodes ${w.name} as ${row?.codec}, not ${w.codec}`,
      );
      if (w.scalabilityMode) {
        check(
          out.scalabilityMode === w.scalabilityMode,
          `A encodes ${w.name} as ${out.scalabilityMode}`,
        );
      }
      return `${w.name}: ${out.codec} -> ${row.codec} ${row.frames[1]}f`;
    });
    return { summary: codecs.join("; "), results };
  },

  /**
   * A camera turned off and on twice: once with removeTrack, which leaves an
   * inactive section, and once with transceiver.stop(), whose m-line the
   * browser may recycle for the next camera. Every new camera gets a new
   * section at the receiver, and the old ones stay inactive.
   */
  async k(s) {
    const A = await s.join("A");
    const B = await s.join("B");
    const steps = [];

    const cameraMidAtB = async () => {
      const { mapping } = await directoryReady(B, s.clients);
      return mapping.find((m) => m.publication.kind === "video").mid;
    };
    const inactiveAtB = (mid) =>
      waitFor(`B's section ${mid} to go inactive`, async () => {
        const snapshot = await B.snapshot();
        const t = snapshot.transceivers.find((x) => x.mid === mid);
        return t?.currentDirection === "inactive" && !snapshot.directory.some((e) => e.mid === mid);
      });
    const mLines = async () =>
      (await A.descriptions())
        .filter((d) => d.side === "local" && d.type === "offer")
        .pop()
        .sdp.split("\r\nm=").length - 1;

    const mids = [];
    for (const how of ["remove", "stop", null]) {
      const camera = await A.publish("camera", "video");
      await verifyRoom(s.env, s.clients);
      const atB = await cameraMidAtB();
      check(!mids.includes(atB), `B received the new camera on an old section ${atB}`);
      mids.push(atB);
      steps.push(`camera at A ${camera.mid}, B ${atB}, A offers ${await mLines()} m-lines`);
      if (!how) break;
      await A.unpublish("camera", how);
      await inactiveAtB(atB);
      steps.push(`${how}: B's ${atB} inactive`);
    }

    const results = await verifyRoom(s.env, s.clients);
    const snapshot = await B.snapshot();
    for (const mid of mids.slice(0, -1)) {
      const t = snapshot.transceivers.find((x) => x.mid === mid);
      check(t.currentDirection === "inactive", `B's old section ${mid} is ${t.currentDirection}`);
    }
    return { summary: `${steps.join("; ")}; ${summarise(results)}`, results };
  },

  /**
   * A publisher's Opus encoder runs on the profile its own client wrote into
   * its offer: A tunes its microphone to 128 kb/s mono and a screen audio
   * track to 160 kb/s stereo, B tunes nothing. The encoder takes its
   * parameters from the media server's descriptions, so they must carry the
   * publisher's own, in the answer and in every later offer.
   */
  async j(s) {
    const A = await s.join("A");
    const screen = await A.publish("screen-audio", "audio", { stereo: true });
    const B = await s.join("B");
    const results = await verifyRoom(s.env, s.clients);

    const sentA = (await A.stats()).outbound;
    const sentB = (await B.stats()).outbound;
    const mic = sentA[A.publications.find((p) => p.name === "mic").mid];
    const stereo = sentA[screen.mid];
    const plain = sentB[B.publications[0].mid];
    const describe = (o) => `${Math.round(o.targetBitrate / 1000)} kb/s (${o.codec})`;
    check(
      mic.codec.includes("maxaveragebitrate=128000") && mic.targetBitrate >= 100_000,
      `A's microphone encodes at ${describe(mic)}`,
    );
    check(
      stereo.codec.includes("stereo=1") && stereo.targetBitrate >= 128_000,
      `A's screen audio encodes at ${describe(stereo)}`,
    );
    check(plain.targetBitrate <= 40_000, `B's untuned microphone encodes at ${describe(plain)}`);
    return {
      summary: `A mic ${describe(mic)}; A screen audio ${describe(stereo)}; B mic ${describe(plain)}`,
      results,
    };
  },

  /** The selected candidate pair of every page ends at the media server. */
  async g(s) {
    await s.join("A");
    await s.join("B");
    await s.join("C");
    const results = await verifyRoom(s.env, s.clients);
    const pairs = results.map(
      (r) =>
        `${r.name}: ${r.pair.local.candidateType} ${r.pair.local.address}:${r.pair.local.port} -> ` +
        `${r.pair.remote.candidateType} ${r.pair.remote.address}:${r.pair.remote.port} ` +
        `(${r.pair.state}, ICE ${r.pair.iceRole}, DTLS ${r.pair.dtlsRole})`,
    );
    return { summary: pairs.join("; "), results };
  },

  /**
   * addTrack instead of addTransceiver: Chromium offers sendrecv, which the
   * media server answers as receive-only, and the track is published. A
   * later addTrack reuses a receiving section the media server created; the
   * media server never takes media there.
   */
  async h(s) {
    const A = await s.join("A", { via: "addTrack" });
    const B = await s.join("B");
    await verifyRoom(s.env, s.clients);

    const offerOfA = (await A.descriptions()).find((d) => d.side === "local" && d.type === "offer");
    const answerToA = (await A.descriptions()).find(
      (d) => d.side === "remote" && d.type === "answer",
    );
    const mid = A.publications[0].mid;
    const directionIn = (sdp) =>
      sdp
        .split("\r\nm=")
        .find((section) => section.includes(`a=mid:${mid}\r\n`))
        ?.match(/a=(sendrecv|sendonly|recvonly|inactive)/)?.[1];
    const transceiver = (await A.snapshot()).transceivers.find((t) => t.mid === mid);
    check(directionIn(answerToA.sdp) === "recvonly", "the media server did not answer recvonly");

    // B already receives A's microphone on a section the media server made.
    const reuse = await B.publish("mic2", "audio", { via: "addTrack" });
    B.publications.pop();
    await settle(s);
    const results = await verifyRoom(s.env, s.clients);
    const snapshotA = await A.snapshot();
    check(
      snapshotA.directory.length === 1,
      `A's directory has ${snapshotA.directory.length} entries after B's addTrack`,
    );
    return {
      summary:
        `A offered ${directionIn(offerOfA.sdp)}, was answered ${directionIn(answerToA.sdp)}, ` +
        `direction ${transceiver.direction}/${transceiver.currentDirection}; ` +
        `B's addTrack reused a server section: ${reuse.reusedTransceiver} (mid ${reuse.mid}, ` +
        `direction ${reuse.direction}); ${summarise(results)}`,
      results,
    };
  },

  /**
   * A call outlives every timer of the media server: the 10 second offer
   * timeout, the 15 seconds after which ICE-lite calls a quiet pair
   * disconnected and the 30 second rules. Media keeps flowing, the media
   * server keeps both sessions connected and closes nothing.
   */
  async l(s) {
    const A = await s.join("A");
    await A.publish("camera", "video");
    await s.join("B");
    await verifyRoom(s.env, s.clients);

    const samples = [];
    for (let i = 0; i < 5; i += 1) {
      await sleep(9000);
      const results = await verifyRoom(s.env, s.clients);
      const stats = await s.env.hub.control.request("GET", "/v1/stats");
      const room = stats.body.rooms.find((r) => r.roomId === s.room);
      const states = room.sessions.map((x) => x.state);
      check(
        states.length === 2 && states.every((x) => x === "connected"),
        `the media server reports ${states}`,
      );
      samples.push(`${(i + 1) * 10}s ${states.join("/")} ${summarise(results)}`);
    }
    return { summary: samples.join(" | ") };
  },

  /**
   * A person with nothing to publish offers one receive-only audio section,
   * which the media server answers inactive, and then receives everybody.
   */
  async m(s) {
    const listener = await s.join("C", { mic: false });
    await listener.receiveOnly("audio");
    await s.join("A");
    const results = await verifyRoom(s.env, s.clients);
    const own = (await listener.snapshot()).transceivers.find((t) => t.mid === "0");
    check(own.currentDirection === "inactive", `C's own section is ${own.currentDirection}`);
    return {
      summary: `C's own section ${own.direction}/${own.currentDirection}; ${summarise(results)}`,
      results,
    };
  },

  /**
   * Through a NAT that loses every 15th camera packet on the way to the
   * media server and on the way from it. The media server asks the
   * publisher to resend what it lost and resends what the receiver lost,
   * each on its own leg, and the picture keeps going. The media server is
   * a second process here, advertising the NAT's address, not its own.
   */
  async n(s) {
    const env = s.env;
    const nat = await LossyNat.listen();
    const logFile = join(env.out, "stellarr-media-nat.log");
    const media = await startMedia({ binary: env.binary, logFile, advertisePort: nat.port });
    nat.target = media.port;
    console.log(
      `  n: second media server pid ${media.pid}, bound 127.0.0.1:${media.port}, ` +
        `advertised ${media.candidate}`,
    );
    const hub = new Hub(media.control);
    await hub.start();
    const inner = new Scenario(
      { ...env, hub, candidate: media.candidate, logText: () => readFileSync(logFile, "utf8") },
      "n",
    );
    try {
      const A = await inner.join("A");
      const camera = await A.publish("camera", "video");
      const B = await inner.join("B");
      await verifyRoom(inner.env, inner.clients);

      const { mapping } = await directoryReady(B, inner.clients);
      const mid = mapping.find((m) => m.publication.kind === "video").mid;
      const before = {
        sent: (await A.stats()).outbound[camera.mid],
        got: (await B.stats()).inbound[mid],
      };
      nat.lose({ pt: 96, every: 15 });
      await sleep(6000);
      const results = await verifyRoom(inner.env, inner.clients);
      nat.lose({ pt: 96, every: 0 });
      const sent = (await A.stats()).outbound[camera.mid];
      const got = (await B.stats()).inbound[mid];

      check(nat.lost.up > 0 && nat.lost.down > 0, `the NAT lost ${JSON.stringify(nat.lost)}`);
      check(sent.codec.startsWith("video/VP8"), `A sends ${sent.codec}, not VP8 on 96`);
      const upNacks = sent.nackCount - before.sent.nackCount;
      const resent = sent.retransmittedPacketsSent - before.sent.retransmittedPacketsSent;
      const downNacks = got.nackCount - before.got.nackCount;
      const repaired = got.retransmittedPacketsReceived - before.got.retransmittedPacketsReceived;
      check(upNacks > 0 && resent > 0, `A got ${upNacks} NACKs and resent ${resent} packets`);
      check(downNacks > 0 && repaired > 0, `B sent ${downNacks} NACKs and got ${repaired} resent`);
      await inner.verifyClean();
      return {
        summary:
          `lost up ${nat.lost.up}, down ${nat.lost.down}; A got ${upNacks} NACKs, resent ${resent}; ` +
          `B sent ${downNacks} NACKs, got ${repaired} resent, lost ${got.packetsLost}, ` +
          `freezes ${got.freezeCount}; ${summarise(results)}`,
        results,
      };
    } finally {
      await inner.dump().catch(() => {});
      await inner.cleanup();
      await hub.stop();
      await media.stop();
      nat.close();
    }
  },

  /**
   * A browser that answers late: the media server's offer is held from the
   * page past the 10 second offer timeout, so the media server rolls it back
   * and offers again before the page has seen the first one. The page then
   * applies both. A late answer must never leave a session alive and broken:
   * it either recovers or ends with `error`, which the client answers by
   * opening a new session. The others are not affected.
   */
  async o(s) {
    await s.join("A");
    const B = await s.join("B");
    const C = await s.join("C");
    await verifyRoom(s.env, s.clients);
    const hub = s.env.hub;
    s.tolerated.add(C.sessionId);

    hub.hold(C.sessionId);
    const held = Date.now();
    await B.publish("camera", "video");
    const offers = () => hub.heldEvents(C.sessionId).filter((e) => e.kind === "offer");
    await waitFor("a second offer to C", async () => offers().length >= 2, 15_000);
    const heldIds = offers().map((e) => e.payload.negotiationId);
    await hub.release(C.sessionId);

    const outcome = await waitFor(
      "C's session to recover or close",
      async () => {
        const closed = hub.eventsOf(C.sessionId).find((e) => e.type === "closed");
        if (closed) return { closed };
        const snapshot = await C.snapshot();
        return snapshot.directory.length === 4 && snapshot.errors.length === 0
          ? { recovered: true }
          : null;
      },
      45_000,
      500,
    );
    const seconds = Math.round((Date.now() - held) / 1000);
    const snapshot = await C.snapshot();
    const answers = hub
      .callsOf(C.sessionId)
      .filter((c) => c.kind === "answer")
      .map((c) => `${c.negotiationId}:${c.status}`);
    const errors = snapshot.errors.map((e) => e.split("\n")[0]);
    let what;
    if (outcome.closed) {
      check(outcome.closed.reason === "error", `C was closed with ${outcome.closed.reason}`);
      what = `closed with ${outcome.closed.reason} ${seconds} s after the hold began`;
      await leave(C);
    } else {
      await verifyReceiver(s.env, C, s.clients);
      what = `recovered ${seconds} s after the hold began`;
    }
    const results = await verifyRoom(s.env, s.clients);
    return {
      summary:
        `held offers ${heldIds}; C answered ${answers}; C's errors ${JSON.stringify(errors)}; ` +
        `${what}; ${summarise(results)}`,
      results,
    };
  },
};

async function settle(s) {
  await Promise.all(s.clients.map((c) => s.env.hub.posted(c.sessionId)));
  await sleep(500);
}

// -------------------------------------------------------------------- main

// An interrupted run still stops what it started: the exit handler of
// lib/media.mjs ends the media servers, and Playwright closes its browsers.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.log(`stopped by ${signal}`);
    process.exit(130);
  });
}

async function main() {
  const wanted = process.argv.slice(2);
  const ids = Object.keys(SCENARIOS)
    .sort()
    .filter((id) => wanted.length === 0 || wanted.includes(id));
  const out =
    process.env.STELLARR_SMOKE_OUT ?? mkdtempSync(join(tmpdir(), "stellarr-media-smoke-"));
  mkdirSync(out, { recursive: true });

  const binary =
    process.env.STELLARR_MEDIA_BINARY ?? resolve(here, "../target/release/stellarr-media");
  const logFile = join(out, "stellarr-media.log");
  const executablePath = browserPath();
  console.log(`browser ${executablePath}\noutput ${out}`);

  const cleanup = [];
  let failed = 0;
  try {
    const media = await startMedia({
      binary,
      logFile,
      advertiseHost: process.env.STELLARR_SMOKE_ADVERTISE ?? "127.0.0.1",
    });
    cleanup.push(() => media.stop());
    const hub = new Hub(media.control);
    await hub.start();
    cleanup.push(() => hub.stop());

    const page = await servePage(join(here, "page"));
    cleanup.push(() => page.close());

    const identities = writeFixtures(out);
    const browsers = {};
    for (const identity of identities) {
      browsers[identity.name] = await launch(executablePath, identity);
      cleanup.push(() => browsers[identity.name].close());
    }

    const env = {
      binary,
      hub,
      url: page.url,
      candidate: media.candidate,
      identities,
      browsers,
      out,
      logText: () => readFileSync(logFile, "utf8"),
    };
    console.log(`media server pid ${media.pid}, candidate ${media.candidate}`);

    const report = {};
    for (const id of ids) {
      const scenario = new Scenario(env, id);
      const started = Date.now();
      try {
        const result = await SCENARIOS[id](scenario);
        await scenario.verifyClean();
        report[id] = { passed: true, ...result };
        console.log(`PASS ${id} (${Date.now() - started} ms) ${result.summary}`);
      } catch (error) {
        failed += 1;
        report[id] = { passed: false, error: String(error.stack ?? error) };
        console.log(`FAIL ${id} (${Date.now() - started} ms) ${error.message}`);
        if (!(error instanceof Failure)) console.log(error.stack);
      }
      await scenario.dump().catch((error) => console.log(`dump of ${id} failed: ${error}`));
      await scenario.cleanup();
    }

    if (hub.resets > 0 || hub.pumpError) {
      failed += 1;
      console.log(`FAIL hub: ${hub.resets} resets, ${hub.pumpError ?? "no poll error"}`);
    }
    writeFileSync(join(out, "results.json"), JSON.stringify(report, null, 2));
  } finally {
    for (const step of cleanup.reverse()) {
      try {
        const result = await step();
        if (result && typeof result === "object" && "code" in result) {
          console.log(`media server stopped with ${JSON.stringify(result)}`);
        }
      } catch (error) {
        console.log(`cleanup: ${error}`);
      }
    }
  }

  console.log(failed === 0 ? "all scenarios passed" : `${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
