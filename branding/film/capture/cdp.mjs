// Minimal Chromium driver over the DevTools Protocol (no npm packages).
// Each "context" is an isolated browser context (own cookies/storage) = one demo user.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ headless = true, extra = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "film-cap-"));
  const flags = [
    headless ? "--headless=new" : "",
    "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio",
    "--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text",
    "--lang=en-US", "--accept-lang=en-US,en",
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1920,1080",
    ...extra,
    "about:blank",
  ].filter(Boolean);
  const proc = spawn(process.env.CHROME || "/usr/bin/chromium", flags, { stdio: ["ignore", "ignore", "pipe"], detached: true, env: { ...process.env, LANG: "en_US.UTF-8", LANGUAGE: "en_US" } });
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
    proc.on("exit", (c) => rej(new Error("chromium exited " + c + buf.slice(-400))));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}, sessionId) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const browser = {
    send,
    listeners,
    async newPage({ isolated = true, width = 1920, height = 1080, scale = 1 } = {}) {
      let browserContextId;
      if (isolated) ({ browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: false }));
      const { targetId } = await send("Target.createTarget", { url: "about:blank", ...(browserContextId ? { browserContextId } : {}) });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const page = makePage(send, listeners, sessionId, targetId);
      await page.cmd("Page.enable");
      await page.cmd("Runtime.enable");
      await page.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
      await page.cmd("Emulation.setLocaleOverride", { locale: "en-US" }).catch(() => {});
      await page.cmd("Emulation.setTimezoneOverride", { timezoneId: "Europe/Warsaw" }).catch(() => {});
      if (browserContextId) {
        await send("Browser.grantPermissions", { browserContextId, permissions: ["audioCapture", "videoCapture", "displayCapture", "clipboardReadWrite", "notifications"], origin: process.env.STELLARR_FILM_WEB || "http://127.0.0.1:3100" }).catch((e) => console.error("grant", e.message));
      }
      page.browserContextId = browserContextId;
      return page;
    },
    async close() {
      try { await send("Browser.close"); } catch {}
      await sleep(500);
      try { process.kill(-proc.pid, "SIGKILL"); } catch {}
      rmSync(profile, { recursive: true, force: true });
    },
  };
  return browser;
}

function makePage(send, listeners, sessionId, targetId) {
  const page = {
    sessionId,
    targetId,
    cmd: (m, p = {}) => send(m, p, sessionId),
    async goto(url, { wait = 1500 } = {}) {
      const loaded = new Promise((res) => {
        const l = (msg) => {
          if (msg.sessionId === sessionId && msg.method === "Page.loadEventFired") {
            listeners.delete(l);
            res();
          }
        };
        listeners.add(l);
      });
      await page.cmd("Page.navigate", { url });
      await Promise.race([loaded, sleep(60000)]);
      await sleep(wait);
    },
    async eval(expression) {
      const r = await page.cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expression, timeout = 30000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { if (await page.eval(expression)) return true; } catch {}
        await sleep(250);
      }
      throw new Error("waitFor timed out: " + expression);
    },
    async shot(path, clip) {
      const r = await page.cmd("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    async click(selector) {
      return page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('no ' + ${JSON.stringify(selector)}); e.click(); return true; })()`);
    },
    // a real mouse click at the centre of an element (for components that listen to pointer events)
    async mouse(selector) {
      const box = await page.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!box) throw new Error("no element " + selector);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.cmd("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      return box;
    },
    async type(text) {
      await page.cmd("Input.insertText", { text });
    },
    async key(key, code = key, keyCode = 0) {
      await page.cmd("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
      await page.cmd("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
  };
  return page;
}

export { sleep };
