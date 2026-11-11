// Headless Chromium and the pages that play the clients.
//
// Each person runs in a browser of their own, because Chromium's fake devices
// are configured per process and every person needs their own tone and
// colour. The page is served from 127.0.0.1, which is a secure context, so
// getUserMedia works without TLS.

import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { chromium } from "playwright-core";

const BROWSERS = ["/usr/bin/chromium", "/usr/bin/google-chrome-stable"];

export function browserPath() {
  const chosen = process.env.STELLARR_SMOKE_BROWSER ?? BROWSERS.find((path) => existsSync(path));
  if (!chosen || !existsSync(chosen)) {
    throw new Error("no Chromium found; set STELLARR_SMOKE_BROWSER to its executable");
  }
  return chosen;
}

// The page's files, by the address the page asks for. Nothing else is served,
// so a request can never name a file of its own choosing.
const PAGE_FILES = new Map([
  ["/", { name: "index.html", type: "text/html" }],
  ["/client.js", { name: "client.js", type: "text/javascript" }],
]);

/** Serves the client page on a spare loopback port. */
export function servePage(dir) {
  const server = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const file = PAGE_FILES.get(request.url);
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": file.type });
    createReadStream(join(dir, file.name)).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export function launch(executablePath, identity) {
  return chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      `--use-file-for-fake-audio-capture=${identity.audio}`,
      `--use-file-for-fake-video-capture=${identity.video}`,
    ],
  });
}

/** One person: a page, its media session and what it published. */
export class Client {
  static async open({ browser, url, hub, identity, roomId, userId, tuneOpus = false }) {
    const sessionId = await hub.createSession(roomId, userId);
    const context = await browser.newContext({ permissions: ["microphone", "camera"] });
    const page = await context.newPage();
    const client = new Client({ hub, identity, roomId, userId, sessionId, context, page });

    page.on("pageerror", (error) => client.pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") client.pageErrors.push(message.text());
    });
    let received = 0;
    await page.exposeFunction("hubSend", (sid, n, kind, payload) => {
      received += 1;
      if (n !== received) client.pageErrors.push(`signal ${n} reached the hub as ${received}`);
      if (sid !== sessionId) {
        client.pageErrors.push(`the page sent a signal for session ${sid}`);
        return;
      }
      hub.send(sid, kind, payload);
    });
    await page.goto(url);
    const started = await page.evaluate((options) => window.smoke.start(options), {
      sessionId,
      tuneOpus,
    });
    if (!started.isSecureContext) throw new Error("the page is not a secure context");

    hub.attach(sessionId, (event) =>
      page
        .evaluate((e) => window.smoke.signal(e), event)
        .catch((error) => client.pageErrors.push(`delivery failed: ${error}`)),
    );
    return client;
  }

  constructor({ hub, identity, roomId, userId, sessionId, context, page }) {
    Object.assign(this, { hub, identity, roomId, userId, sessionId, context, page });
    this.name = identity.name;
    this.publications = [];
    this.pageErrors = [];
    this.left = false;
  }

  /** Publishes the fake microphone ("audio") or camera ("video"). */
  async publish(name, kind, options = {}) {
    const result = await this.page.evaluate(
      ([n, k, o]) => window.smoke.publish(n, k, o),
      [name, kind, options],
    );
    this.publications.push({ name, kind, ...result });
    return result;
  }

  async unpublish(name, how) {
    const result = await this.page.evaluate(([n, h]) => window.smoke.unpublish(n, h), [name, how]);
    this.publications = this.publications.filter((p) => p.name !== name);
    return result;
  }

  async swap(name) {
    const result = await this.page.evaluate((n) => window.smoke.swap(n), name);
    const publication = this.publications.find((p) => p.name === name);
    Object.assign(publication, result);
    return result;
  }

  snapshot() {
    return this.page.evaluate(() => window.smoke.snapshot());
  }

  stats() {
    return this.page.evaluate(() => window.smoke.stats());
  }

  levels() {
    return this.page.evaluate(() => window.smoke.levels());
  }

  receiveOnly(kind) {
    return this.page.evaluate((k) => window.smoke.receiveOnly(k), kind);
  }

  measure() {
    return this.page.evaluate(() => window.smoke.measure());
  }

  descriptions() {
    return this.page.evaluate(() => window.smoke.descriptions());
  }

  /** Leaves as the hub does on LeaveVoice: the session first, then the page. */
  async leave() {
    if (this.left) return;
    this.left = true;
    await this.hub.deleteSession(this.sessionId);
    await this.page.evaluate(() => window.smoke.close()).catch(() => {});
    await this.context.close();
  }
}
