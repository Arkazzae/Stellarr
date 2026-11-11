// The media server process and the part of AppHub that talks to it.
//
// The smoke test plays the hub: it opens and closes sessions on the control
// API, posts every signal a page sends in the order the page sent it, and
// long-polls the event log and hands each event to the page whose session it
// names, in log order. That is the whole signalling path of the contract
// without SignalR in the middle.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { createWriteStream, existsSync } from "node:fs";
import { createServer } from "node:net";

/** A UDP port on 127.0.0.1 that nothing is bound to right now. */
export function freeUdpPort() {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

/** A TCP port on 127.0.0.1 that nothing listens on right now. */
export function freeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A media server must not outlive the script, however the script ends.
const running = new Set();
process.on("exit", () => {
  for (const child of running) child.kill("SIGKILL");
});

/**
 * Starts the release binary on spare loopback ports. `advertiseHost` and
 * `advertisePort` are the address put in every candidate; they default to
 * the bound one.
 */
export async function startMedia({ binary, logFile, advertiseHost = "127.0.0.1", advertisePort }) {
  if (!existsSync(binary)) {
    throw new Error(`${binary} does not exist; run "cargo build --release" in media/ first`);
  }

  const mediaPort = await freeUdpPort();
  const controlPort = await freeTcpPort();
  const secret = randomBytes(16).toString("hex");
  const bindHost = advertiseHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
  const env = {
    ...process.env,
    STELLARR_MEDIA_BIND: `${bindHost}:${mediaPort}`,
    STELLARR_MEDIA_ADVERTISE: `${advertiseHost}:${advertisePort ?? mediaPort}`,
    STELLARR_MEDIA_CONTROL_BIND: `127.0.0.1:${controlPort}`,
    STELLARR_MEDIA_CONTROL_SECRET: secret,
    STELLARR_MEDIA_LOG: process.env.STELLARR_MEDIA_LOG ?? "info,stellarr_media=debug",
  };

  const log = createWriteStream(logFile);
  const child = spawn(binary, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  running.add(child);
  let exited = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
    running.delete(child);
  });

  const control = new Control(`http://127.0.0.1:${controlPort}`, secret);
  for (let attempt = 0; ; attempt += 1) {
    if (exited) throw new Error(`stellarr-media exited at start: ${JSON.stringify(exited)}`);
    try {
      const health = await control.request("GET", "/v1/health");
      if (health.status === 200) break;
    } catch {
      // Not listening yet.
    }
    if (attempt > 100) throw new Error("stellarr-media did not answer /v1/health");
    await sleep(50);
  }

  return {
    control,
    candidate: `${advertiseHost}:${advertisePort ?? mediaPort}`,
    port: mediaPort,
    pid: child.pid,
    exited: () => exited,
    async stop() {
      if (!exited) {
        child.kill("SIGTERM");
        for (let i = 0; i < 100 && !exited; i += 1) await sleep(50);
        if (!exited) child.kill("SIGKILL");
      }
      await new Promise((resolve) => log.end(resolve));
      return exited;
    },
  };
}

/** The control API with its bearer secret. */
export class Control {
  constructor(base, secret) {
    this.base = base;
    this.secret = secret;
  }

  async request(method, path, body) {
    const response = await fetch(this.base + path, {
      method,
      headers: {
        authorization: `Bearer ${this.secret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
}

/**
 * The hub. Sessions are attached to a `deliver` function that hands one
 * event to the page; events of one session are delivered one at a time, in
 * order, and can be held back to stage a collision.
 */
export class Hub {
  constructor(control) {
    this.control = control;
    this.sessions = new Map();
    /** Every event, in log order, as the hub saw it. */
    this.events = [];
    /** Every control API call made for a page, with its outcome. */
    this.calls = [];
    this.resets = 0;
    this.stopped = false;
  }

  async start() {
    const health = await this.control.request("GET", "/v1/health");
    this.epoch = health.body.epoch;
    this.after = 0;
    this.pumping = this.pump();
  }

  async stop() {
    this.stopped = true;
    await this.pumping;
  }

  async pump() {
    while (!this.stopped) {
      let reply;
      try {
        reply = await this.control.request(
          "GET",
          `/v1/events?epoch=${this.epoch}&after=${this.after}&waitMs=500`,
        );
      } catch (error) {
        if (this.stopped) return;
        this.pumpError = String(error);
        await sleep(200);
        continue;
      }
      if (reply.status !== 200) {
        this.pumpError = `GET /v1/events answered ${reply.status}`;
        await sleep(200);
        continue;
      }
      if (reply.body.reset) {
        this.resets += 1;
        this.epoch = reply.body.epoch;
        this.after = 0;
        continue;
      }
      for (const event of reply.body.events) {
        this.after = event.seq;
        this.events.push({ ...event, at: Date.now() });
        const session = this.sessions.get(event.sessionId);
        if (session) this.enqueue(session, event);
      }
    }
  }

  async createSession(roomId, userId) {
    const reply = await this.control.request("POST", "/v1/sessions", { roomId, userId });
    if (reply.status !== 201) {
      throw new Error(`POST /v1/sessions answered ${reply.status} ${JSON.stringify(reply.body)}`);
    }
    const session = {
      id: reply.body.sessionId,
      userId,
      deliver: null,
      inbox: [],
      held: false,
      delivering: Promise.resolve(),
      outbox: Promise.resolve(),
    };
    this.sessions.set(session.id, session);
    return session.id;
  }

  /** Routes the events of a session to a page from now on. */
  attach(sessionId, deliver) {
    const session = this.sessions.get(sessionId);
    session.deliver = deliver;
    this.flush(session);
  }

  enqueue(session, event) {
    session.inbox.push(event);
    this.flush(session);
  }

  flush(session) {
    if (session.held || !session.deliver) return;
    const events = session.inbox.splice(0);
    for (const event of events) {
      session.delivering = session.delivering.then(() => session.deliver(event));
    }
  }

  /** Holds back every event of a session, so they arrive later in one go. */
  hold(sessionId) {
    this.sessions.get(sessionId).held = true;
  }

  /** The events held back so far. */
  heldEvents(sessionId) {
    return [...this.sessions.get(sessionId).inbox];
  }

  async release(sessionId) {
    const session = this.sessions.get(sessionId);
    session.held = false;
    this.flush(session);
    await session.delivering;
  }

  /**
   * Posts one signal of a page. Signals of one session are posted one after
   * another, in the order the page sent them, as the hub's ordered
   * invocation of `SendMediaSignal` would.
   */
  send(sessionId, kind, payload) {
    const session = this.sessions.get(sessionId);
    const body =
      kind === "offer"
        ? { sdp: payload.sdp }
        : kind === "answer"
          ? { sdp: payload.sdp, negotiationId: payload.negotiationId }
          : { candidate: payload };
    const call = { sessionId, kind, at: Date.now(), negotiationId: payload?.negotiationId };
    this.calls.push(call);
    session.outbox = session.outbox.then(async () => {
      try {
        const reply = await this.control.request(
          "POST",
          `/v1/sessions/${sessionId}/${kind}`,
          body,
        );
        call.status = reply.status;
        call.reply = reply.body;
      } catch (error) {
        call.status = 0;
        call.reply = String(error);
      }
    });
    return session.outbox;
  }

  /** Waits until every signal a session sent has been posted. */
  async posted(sessionId) {
    await this.sessions.get(sessionId).outbox;
  }

  async deleteSession(sessionId) {
    const reply = await this.control.request("DELETE", `/v1/sessions/${sessionId}`);
    const session = this.sessions.get(sessionId);
    if (session) session.deliver = null;
    this.sessions.delete(sessionId);
    return reply.status;
  }

  eventsOf(sessionId) {
    return this.events.filter((e) => e.sessionId === sessionId);
  }

  signalsOf(sessionId, kind) {
    return this.eventsOf(sessionId).filter((e) => e.type === "signal" && e.kind === kind);
  }

  callsOf(sessionId) {
    return this.calls.filter((c) => c.sessionId === sessionId);
  }
}
