// Captures the real Stellarr screens the film uses, from the throwaway demo instance (see ../README.md).
//   node capture.mjs                        # every step
//   node capture.mjs chat translate voice appearance cockpit
// Afterwards run node pack.mjs, which moves the shared stylesheet out of the snapshots and drops unused files.
import { launch, sleep } from "./cdp.mjs";
import { BASE, installApi, api } from "./api.mjs";
import { snapshot } from "./snap.mjs";
import { mkdirSync } from "node:fs";

const FILM = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const COCKPIT = process.env.STELLARR_FILM_COCKPIT || "http://127.0.0.1:3101";
const SHOTS = FILM + "/out/capture/"; // reference screenshots of the live app, to compare with stills
mkdirSync(SHOTS, { recursive: true });
const steps = new Set(process.argv.slice(2));
const want = (s) => steps.size === 0 || steps.has(s);

const b = await launch();
const pages = {};
const open = async (u, { translation = false } = {}) => {
  const p = await b.newPage();
  await p.goto(`${BASE}/login`, { wait: 800 });
  await installApi(p);
  await api(p, "POST", "/api/auth/login", { username: u, password: "demo-pass-2026" });
  if (translation)
    await p.eval(`localStorage.setItem("stellarr_language_settings", JSON.stringify({ chatTranslationEnabled: true, chatAutoTranslateEnabled: false, chatTranslationTargetLanguage: "en" })), true`);
  await p.goto(`${BASE}/`, { wait: 4000 });
  pages[u] = p;
  return p;
};
const findAndClick = (p, text, scope = "body") => p.eval(`(() => {
  const want = ${JSON.stringify(text)}, sc = ${JSON.stringify(scope)};
  const ctl = [...document.querySelectorAll(sc + ' button, ' + sc + ' a, ' + sc + ' [role=button], ' + sc + ' [role=tab], ' + sc + ' [role=radio], ' + sc + ' [role=option], ' + sc + ' label')]
    .find(e => e.textContent.trim() === want);
  if (ctl) { ctl.click(); return true; }
  const leaf = [...document.querySelectorAll(sc + ' *')].find(e => e.children.length === 0 && e.textContent.trim() === want);
  if (!leaf) return false;
  (leaf.closest('button,a,[role=button],[role=tab],[role=radio],[role=option],label') || leaf).click(); return true;
})()`);
const clickByLabel = (p, label) => p.eval(`(() => { const e = document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']'); if (!e) return false; e.click(); return true; })()`);
// a click that finds nothing is reported, because the screen it leads to would come out wrong
const clickText = async (p, text, scope) => { const ok = await findAndClick(p, text, scope); if (!ok) console.log(`click on "${text}" found nothing`); return ok; };
const clickLabel = async (p, label) => { const ok = await clickByLabel(p, label); if (!ok) console.log(`click on [aria-label="${label}"] found nothing`); return ok; };
const report = (name, r) => console.log(name, `${(r.bytes / 1024).toFixed(0)} KB`, r.problems.length ? r.problems : "", r.videos.length ? `videos: ${JSON.stringify(r.videos)}` : "");

try {
  for (const u of ["theo", "priya", "jonas", "kenji", "ola"]) await open(u);
  const maya = await open("maya");
  await sleep(1500);

  if (want("chat")) {
    await maya.shot(SHOTS + "chat.png");
    report("chat", await snapshot(maya, "chat", FILM));
  }

  if (want("translate")) {
    // a second session of Maya with message translation switched on in Settings > Language
    const p0 = pages.maya;
    const maya = await open("maya", { translation: true });
    pages.maya = p0;
    await maya.shot(SHOTS + "translate-before.png");
    report("translate-before", await snapshot(maya, "translate-before", FILM));
    // the Translate action under Ola's Polish message (the last one); the model runs in this browser
    const ok = await maya.eval(`(() => { const all = [...document.querySelectorAll('.msg-translation-toggle')]; const e = all[all.length - 1]; if (!e) return false; e.click(); return e.textContent; })()`);
    console.log("translate clicked", ok);
    try {
      await maya.waitFor(`document.body.innerText.includes("Show original")`, 120000);
      await sleep(800);
      await maya.shot(SHOTS + "translated.png");
      report("translated", await snapshot(maya, "translated", FILM));
    } catch (e) {
      console.log("translation did not finish:", e.message);
      await maya.shot(SHOTS + "translate-fail.png");
    }
  }

  if (want("voice")) {
    for (const u of ["priya", "jonas", "theo"]) {
      await clickText(pages[u], "lounge");
      await sleep(2000);
    }
    await clickText(maya, "lounge");
    await sleep(5000);
    await maya.shot(SHOTS + "voice.png");
    report("voice", await snapshot(maya, "voice", FILM));
    // Jonas shares a screen: a canvas stream stands in for the display picker of a headless browser
    // (the film draws its own editor where the <video> is)
    await pages.jonas.eval(`(() => {
      const c = document.createElement("canvas"); c.width = 1920; c.height = 1080;
      const g = c.getContext("2d"); g.fillStyle = "#1b1d22"; g.fillRect(0, 0, 1920, 1080);
      const stream = c.captureStream(15);
      setInterval(() => { g.fillStyle = "#1b1d22"; g.fillRect(0, 0, 1920, 1080); g.fillStyle = "#6f65d1"; g.fillRect(100 + (performance.now() / 10) % 1600, 500, 80, 80); }, 66);
      navigator.mediaDevices.getDisplayMedia = async () => stream;
      return true;
    })()`);
    const shared = await clickLabel(pages.jonas, "Share screen");
    console.log("share clicked", shared);
    await sleep(5500);
    console.log("watch", await clickText(maya, "Watch"));
    await sleep(4000);
    await maya.shot(SHOTS + "voice-share.png");
    report("voice-share", await snapshot(maya, "voice-share", FILM));
  }

  if (want("appearance")) {
    await clickLabel(maya, "User settings");
    await sleep(1500);
    await clickText(maya, "Appearance", "[role=dialog]");
    await sleep(1500);
    await maya.shot(SHOTS + "appearance.png");
    report("appearance", await snapshot(maya, "appearance", FILM));
    // every palette as the app applies it to <html>, read back after choosing it
    const names = ["Midnight", "Slate", "Evergreen", "Harbor", "Amethyst", "Ink"];
    const palettes = {};
    for (const n of [...names.slice(1), "Midnight"]) {
      const ok = await clickText(maya, n, "[role=dialog]");
      await sleep(700);
      palettes[n] = await maya.eval(`({ ok: ${ok}, theme: document.documentElement.dataset.theme, style: document.documentElement.getAttribute("style") })`);
      if (n === "Evergreen") await maya.shot(SHOTS + "appearance-evergreen.png");
    }
    const { writeFileSync } = await import("node:fs");
    writeFileSync(FILM + "/ui/palettes.js", "// The six palettes of the Stellarr web client, as the app writes them on <html> (captured from the Appearance settings).\nwindow.UI_PALETTES = " + JSON.stringify(palettes, null, 1) + ";\n");
    console.log(Object.fromEntries(Object.entries(palettes).map(([k, v]) => [k, v.theme])));
  }
  if (want("cockpit")) {
    const c = await b.newPage();
    await c.goto(COCKPIT + "/", { wait: 3000 });
    const r = await c.eval(`fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Stellarr-Client": "cockpit", "X-Stellarr-Client-Version": "0.1.0" }, body: JSON.stringify({ username: "maya", password: "demo-pass-2026" }) }).then(r => r.status)`);
    console.log("cockpit login", r);
    await c.goto(COCKPIT + "/", { wait: 6000 });
    const ok = await c.eval(`(() => { const a = [...document.querySelectorAll('a[href]')].find(a => a.getAttribute('href').endsWith("/runtime")); if (!a) return false; a.click(); return true; })()`);
    await sleep(4000);
    await c.shot(SHOTS + "cockpit-runtime.png");
    if (ok) report("cockpit-runtime", await snapshot(c, "cockpit-runtime", FILM));
    else console.log("Cockpit's Runtime link was not found");
  }
} finally {
  await b.close();
}
