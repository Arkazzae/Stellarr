// After capture.mjs: every snapshot carries the same stylesheet, so it moves to ui/shared.js once
// (one for the web client, one for Cockpit), together with the font faces the film needs; files in
// ui/static that no snapshot refers to any more are removed.
import { readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";

const UI = new URL("../ui/", import.meta.url).pathname;
const KEEP = ["chat", "translate-before", "translated", "voice", "voice-share", "appearance", "cockpit-runtime"];
const FAMILIES = new Set(["Outfit", "Geist", "__nextjs-Geist", "JetBrains Mono"]);

const window = {};
for (const n of KEEP) new Function("window", readFileSync(UI + n + ".js", "utf8"))(window);
const snaps = window.UI_SNAP;
let shared = { UI_CSS: {}, UI_FONTS: [], UI_PROPS: [] };
try {
  const w = {};
  new Function("window", readFileSync(UI + "shared.js", "utf8"))(w);
  shared = { UI_CSS: w.UI_CSS || {}, UI_FONTS: w.UI_FONTS || [], UI_PROPS: w.UI_PROPS || [] };
} catch {}
const fonts = new Set(shared.UI_FONTS), props = new Set(shared.UI_PROPS);
for (const n of KEEP) {
  const s = snaps[n];
  if (!s) throw new Error(`ui/${n}.js has no snapshot; capture it first`);
  if (s.cssRef) continue; // packed already
  const key = n.startsWith("cockpit") ? "cockpit" : "app";
  shared.UI_CSS[key] = s.css;
  for (const f of s.fonts) {
    const fam = (f.match(/font-family:\s*"?([^;"]+)"?/) || [])[1];
    // Cockpit's own copy of Outfit (a Vite path) duplicates the web client's
    if (FAMILIES.has(fam) && !f.includes("ui/static/src/assets/")) fonts.add(f);
  }
  for (const p of s.props) props.add(p);
  const out = { ...s, cssRef: key };
  delete out.css;
  delete out.fonts;
  delete out.props;
  writeFileSync(UI + n + ".js", `// Snapshot of the real Stellarr web client (${n}), captured from a local demo instance with fictional people.\n(window.UI_SNAP ||= {})[${JSON.stringify(n)}] = ${JSON.stringify(out)};\n`);
}
writeFileSync(
  UI + "shared.js",
  "// The web client's and Cockpit's stylesheets as the browser had them at 1920x1080 (media queries resolved, animations removed),\n" +
    "// and the font faces and registered properties the snapshots use.\n" +
    `window.UI_CSS = ${JSON.stringify(shared.UI_CSS)};\nwindow.UI_FONTS = ${JSON.stringify([...fonts], null, 1)};\nwindow.UI_PROPS = ${JSON.stringify([...props])};\n`,
);

// prune ui/static
const refs = new Set();
for (const f of readdirSync(UI).filter((f) => f.endsWith(".js"))) for (const m of readFileSync(UI + f, "utf8").matchAll(/ui\/static\/[\w./-]+/g)) refs.add(m[0]);
let removed = 0;
const walk = (dir, rel) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`, r = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      walk(p, r);
      if (!readdirSync(p).length) rmdirSync(p);
    } else if (!refs.has(r) && e.name !== "OFL.txt") {
      unlinkSync(p);
      removed++;
    }
  }
};
walk(UI + "static", "ui/static");
console.log(`packed ${KEEP.length} snapshots, removed ${removed} unused files`);
