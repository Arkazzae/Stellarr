// Smoke test for the translation runtime: runs the real worker and WASM in
// headless Chromium against the files in public/. Models are fetched through a
// local stand-in for the /bergamot-models-gcs proxy, so the test needs network
// access to the model bucket but no running Stellarr. It is not part of CI.
//
//   npm run test:translation-runtime        (STELLARR_CHROMIUM overrides the binary)
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const publicRoot = resolve(import.meta.dirname, "..", "public");
const chromium = process.env.STELLARR_CHROMIUM ?? "/usr/bin/chromium";
const modelBucket = "https://storage.googleapis.com/bergamot-models-sandbox/0.3.3";
const modelFilesPerPair = 3;
const startupTimeoutMs = 15_000;
const runTimeoutMs = 120_000;

const mimeTypes = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

// The page reports through its title, which the DevTools target list exposes
// without a protocol session.
const fixturePage = `<!doctype html>
<meta charset="utf-8">
<title>BERGAMOT_PENDING</title>
<script>
  const worker = new Worker("/bergamot-worker.js");
  const give = (verdict, detail) => {
    document.title = "BERGAMOT_" + verdict + " " + detail;
    worker.terminate();
  };
  worker.onerror = (event) => give("ERROR", event.message || "worker error");
  worker.onmessage = ({ data }) =>
    data.type === "result" ? give("OK", data.translation) : give("ERROR", data.message);
  worker.postMessage({
    type: "translate",
    id: 1,
    from: "pl",
    to: "en",
    text: "To jest test lokalnego tłumaczenia.",
  });
</script>`;

let proxiedModelFiles = 0;

async function proxyModel(path, response) {
  proxiedModelFiles += 1;
  const upstream = await fetch(`${modelBucket}/${path}`);
  if (!upstream.ok) {
    response.writeHead(upstream.status).end();
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": body.byteLength,
  });
  response.end(body);
}

async function serveStatic(pathname, response) {
  const file = resolve(publicRoot, `.${pathname}`);
  if (!file.startsWith(publicRoot + sep)) {
    response.writeHead(404).end();
    return;
  }
  const body = await readFile(file);
  response.writeHead(200, {
    "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
    "content-length": body.byteLength,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixturePage);
    } else if (pathname.startsWith("/bergamot-models-gcs/")) {
      await proxyModel(pathname.slice("/bergamot-models-gcs/".length), response);
    } else if (pathname.startsWith("/bergamot-models/") && !pathname.endsWith("/registry.json")) {
      // Like a Stellarr image: only the registry is bundled, model files are not.
      response.writeHead(404).end();
    } else {
      await serveStatic(pathname, response);
    }
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

function listen() {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server.address().port));
  });
}

function startChromium(profile, url) {
  const browser = spawn(
    chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const debuggingPort = new Promise((resolvePort, reject) => {
    const startupTimer = setTimeout(
      () => reject(new Error("Chromium did not open a debugging port.")),
      startupTimeoutMs,
    );
    let log = "";
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", (chunk) => {
      log += chunk;
      const port = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1];
      if (port === undefined) return;
      clearTimeout(startupTimer);
      resolvePort(port);
    });
    browser.once("exit", (code) => {
      clearTimeout(startupTimer);
      reject(new Error(`Chromium exited (${code}).\n${log}`));
    });
  });

  return { browser, debuggingPort };
}

async function waitForVerdict(port, url) {
  const deadline = Date.now() + runTimeoutMs;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    const title = targets.find((target) => target.type === "page" && target.url === url)?.title;
    const verdict = /^BERGAMOT_(OK|ERROR) ([\s\S]*)$/.exec(title ?? "");
    if (verdict !== null) {
      if (verdict[1] === "OK" && verdict[2].trim() !== "") return verdict[2].trim();
      throw new Error(`Bergamot runtime failed: ${verdict[2] || "empty translation"}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Bergamot runtime did not answer in time.");
}

/** One browser session; the profile directory keeps IndexedDB between sessions. */
async function translateOnce(profile, url) {
  const { browser, debuggingPort } = startChromium(profile, url);
  const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
  try {
    return await waitForVerdict(await debuggingPort, url);
  } finally {
    browser.kill("SIGTERM");
    await exited;
  }
}

const profile = await mkdtemp(join(tmpdir(), "stellarr-bergamot-"));
try {
  const url = `http://127.0.0.1:${await listen()}/`;

  const first = await translateOnce(profile, url);
  if (proxiedModelFiles !== modelFilesPerPair) {
    throw new Error(`Expected ${modelFilesPerPair} model downloads, saw ${proxiedModelFiles}.`);
  }

  const second = await translateOnce(profile, url);
  if (proxiedModelFiles !== modelFilesPerPair) {
    throw new Error("The second session downloaded models that IndexedDB should have kept.");
  }

  console.log(`[bergamot] first session:  ${first}`);
  console.log(`[bergamot] second session: ${second}`);
  console.log("[bergamot] WASM, model loading and IndexedDB reuse verified");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true });
}
