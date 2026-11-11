// Freezes the live app into inert markup + flattened CSS for the film.
// In the page: marks scroll offsets and form state, swaps canvases for images, flattens the CSSOM
// (media queries resolved at the capture size, @keyframes dropped, html/body/:root moved onto wrapper
// classes for a shadow root), lists every URL the snapshot needs. In Node: downloads those files into
// the film folder and rewrites the references to relative paths.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const IN_PAGE = String.raw`(async () => {
  const VW = innerWidth, VH = innerHeight;
  for (const e of document.querySelectorAll("[data-film-scroll]")) e.removeAttribute("data-film-scroll");
  for (const e of document.querySelectorAll("*"))
    if (e.scrollTop > 0 || e.scrollLeft > 0) e.setAttribute("data-film-scroll", e.scrollTop + "," + e.scrollLeft);
  for (const i of document.querySelectorAll("input")) {
    if (i.type === "checkbox" || i.type === "radio") i.toggleAttribute("checked", i.checked);
    else i.setAttribute("value", i.value);
  }
  for (const t of document.querySelectorAll("textarea")) t.textContent = t.value;
  for (const s of document.querySelectorAll("select")) for (const o of s.options) o.toggleAttribute("selected", o.selected);
  const canvases = [...document.body.querySelectorAll("canvas")].map((c) => { try { return c.toDataURL("image/png"); } catch { return null; } });
  const videos = [...document.body.querySelectorAll("video")].map((v, i) => {
    v.setAttribute("data-film-video", String(i));
    const r = v.getBoundingClientRect();
    return { i, x: r.left, y: r.top, w: r.width, h: r.height, vw: v.videoWidth, vh: v.videoHeight, cls: v.className };
  });
  // fonts actually in use
  const used = new Set();
  for (const e of document.body.querySelectorAll("*")) {
    const ff = getComputedStyle(e).fontFamily;
    for (const f of ff.split(",")) used.add(f.trim().replace(/^["']|["']$/g, ""));
  }
  const clone = document.body.cloneNode(true);
  for (const e of clone.querySelectorAll("[style]")) for (const k of ["transition", "animation", "will-change"]) e.style.removeProperty(k);
  clone.querySelectorAll("script, nextjs-portal, noscript, template, link, style, iframe").forEach((e) => e.remove());
  [...clone.querySelectorAll("canvas")].forEach((c, i) => {
    if (!canvases[i]) return;
    const img = document.createElement("img");
    img.src = canvases[i];
    for (const a of c.attributes) if (a.name !== "width" && a.name !== "height") img.setAttribute(a.name, a.value);
    img.setAttribute("width", c.getAttribute("width") || "");
    img.setAttribute("height", c.getAttribute("height") || "");
    c.replaceWith(img);
  });
  const fonts = [], props = [];
  const sel = (s) => s
    .replace(/(^|[\s,>+~(])html(?=$|[\s,.:#\[>+~)])/g, "$1.app-html")
    .replace(/(^|[\s,>+~(])body(?=$|[\s,.:#\[>+~)])/g, "$1.app-body")
    .replace(/:root\b/g, ".app-html");
  const walk = (rules, out) => {
    for (const r of rules) {
      const type = r.constructor.name;
      if (type === "CSSFontFaceRule") { fonts.push(r.cssText); continue; }
      if (type === "CSSPropertyRule") { props.push(r.cssText); continue; }
      if (type === "CSSKeyframesRule") continue;
      if (type === "CSSImportRule") { if (r.styleSheet) walk(r.styleSheet.cssRules, out); continue; }
      if (type === "CSSMediaRule") { if (matchMedia(r.media.mediaText).matches) walk(r.cssRules, out); continue; }
      if (type === "CSSLayerStatementRule") { out.push(r.cssText); continue; }
      if (type === "CSSLayerBlockRule") { const inner = []; walk(r.cssRules, inner); out.push("@layer " + r.name + " {\n" + inner.join("\n") + "\n}"); continue; }
      if (type === "CSSSupportsRule") { const inner = []; walk(r.cssRules, inner); out.push("@supports " + r.conditionText + " {\n" + inner.join("\n") + "\n}"); continue; }
      if (type === "CSSContainerRule") { const inner = []; walk(r.cssRules, inner); out.push("@container " + r.conditionText + " {\n" + inner.join("\n") + "\n}"); continue; }
      if (type === "CSSStyleRule") {
        const text = r.cssText;
        out.push(sel(r.selectorText) + " " + text.slice(text.indexOf("{")));
        continue;
      }
      out.push(r.cssText);
    }
  };
  const css = [];
  for (const sh of document.styleSheets) {
    try { walk(sh.cssRules, css); } catch (e) { css.push("/* unreadable sheet " + sh.href + " */"); }
  }
  let cssText = css.join("\n");
  // viewport units are frozen at the capture size, so the snapshot keeps its layout at any window size
  const vu = (s) => s.replace(/(-?\d*\.?\d+)(d|s|l)?v(h|w|min|max)\b/g, (m, n, _k, u) => {
    const base = u === "h" ? VH : u === "w" ? VW : u === "min" ? Math.min(VW, VH) : Math.max(VW, VH);
    return (+(Number(n) * base / 100).toFixed(3)) + "px";
  });
  cssText = vu(cssText);
  // nothing in the snapshot may move on its own clock: the film drives every change from time t
  cssText = cssText.replace(/(^|[{;\s])(transition|animation|will-change)(-[a-z-]+)?\s*:[^;{}]*;?/g, "$1");
  const attrs = Object.fromEntries([...document.documentElement.attributes].map((a) => [a.name, a.value]));
  const bodyAttrs = Object.fromEntries([...document.body.attributes].map((a) => [a.name, a.value]));
  let html = clone.innerHTML;
  html = vu(html);
  // every URL the snapshot refers to
  const urls = new Set();
  const grab = (s) => { for (const m of s.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) urls.add(m[2]); };
  grab(cssText);
  const usedFonts = fonts.filter((f) => { const m = f.match(/font-family:\s*["']?([^;"']+)["']?/); return m && used.has(m[1].trim()); });
  usedFonts.forEach(grab);
  grab(html);
  for (const e of clone.querySelectorAll("img[src], source[src], video[poster]")) urls.add(e.getAttribute("src") || e.getAttribute("poster"));
  for (const e of clone.querySelectorAll("image")) { const h = e.getAttribute("href") || e.getAttribute("xlink:href"); if (h) urls.add(h); }
  for (const e of clone.querySelectorAll("[srcset]")) for (const part of e.getAttribute("srcset").split(",")) urls.add(part.trim().split(/\s+/)[0]);
  const list = [...urls].filter((u) => u && !u.startsWith("data:") && !u.startsWith("#"));
  const files = {};
  for (const u of list) {
    try {
      const abs = new URL(u, location.href);
      if (abs.protocol === "blob:" || abs.origin === location.origin) {
        const res = await fetch(abs.href, { credentials: "same-origin" });
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        files[u] = { ok: res.ok, type: res.headers.get("content-type"), b64: btoa(bin), path: abs.protocol === "blob:" ? null : abs.pathname };
      } else files[u] = { external: abs.href };
    } catch (e) { files[u] = { error: String(e) }; }
  }
  return { html, css: cssText, fonts: usedFonts, props, attrs, bodyAttrs, videos, files, used: [...used], rootFont: getComputedStyle(document.documentElement).fontSize, vw: VW, vh: VH };
})()`;

const EXT = { "image/svg+xml": ".svg", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "font/woff2": ".woff2", "audio/webm": ".webm" };

export async function snapshot(page, name, filmDir) {
  const s = await page.eval(IN_PAGE);
  const map = {};
  let blobN = 0;
  const problems = [];
  for (const [u, f] of Object.entries(s.files)) {
    if (f.external) { problems.push(`external URL kept out: ${f.external}`); map[u] = ""; continue; }
    if (f.error || !f.ok) { problems.push(`could not fetch ${u}: ${f.error || "HTTP error"}`); continue; }
    let rel;
    if (f.path) {
      rel = "ui/static" + decodeURIComponent(f.path).replace(/[^\w./-]/g, "_");
      if (!/\.\w{2,5}$/.test(rel)) rel += EXT[(f.type || "").split(";")[0]] || "";
    } else rel = `ui/static/blob/${name}-${++blobN}${EXT[(f.type || "").split(";")[0]] || ""}`;
    const abs = join(filmDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(f.b64, "base64"));
    map[u] = rel;
  }
  const swap = (text) => {
    let out = text;
    // longest first, so /a/b.svg is not caught by a shorter prefix
    for (const u of Object.keys(map).sort((a, b) => b.length - a.length)) out = out.split(u).join(map[u]);
    return out;
  };
  const data = {
    html: swap(s.html),
    css: swap(s.css),
    fonts: s.fonts.map(swap),
    props: s.props,
    attrs: s.attrs,
    bodyAttrs: s.bodyAttrs,
    videos: s.videos,
    rootFont: s.rootFont,
    size: [s.vw, s.vh],
  };
  mkdirSync(join(filmDir, "ui"), { recursive: true });
  writeFileSync(join(filmDir, "ui", `${name}.js`), `// Snapshot of the real Stellarr web client (${name}), captured from a local demo instance with fictional people.\n(window.UI_SNAP ||= {})[${JSON.stringify(name)}] = ${JSON.stringify(data)};\n`);
  return { problems, bytes: JSON.stringify(data).length, used: s.used, videos: s.videos };
}
