// Mounts a frozen snapshot of the real Stellarr web client (ui/<name>.js) inside a shadow root,
// so the app's CSS and the film's CSS never meet. Fonts and registered properties go to the
// document, because a shadow root ignores @font-face and @property.
(() => {
  const hoist = (rules) => {
    const s = document.createElement("style");
    s.textContent = rules.join("\n");
    document.head.appendChild(s);
  };
  // declared as soon as this script runs, before the film waits for its fonts
  hoist(window.UI_FONTS || []);
  hoist(window.UI_PROPS || []);
  const FREEZE = `*, *::before, *::after { caret-color: transparent !important; }
    .app-html { position: absolute; left: 0; top: 0; overflow: hidden; contain: layout paint; }
    .app-body { margin: 0; width: 100%; height: 100%; position: relative; }`;

  // Returns { host, root (the shadow root), html (.app-html), body (.app-body), $, $$, keepScroll, box }.
  window.mountUI = (parent, name) => {
    const snap = window.UI_SNAP?.[name];
    if (!snap) throw new Error(`UI snapshot "${name}" is not loaded (ui/${name}.js)`);
    const [w, h] = snap.size;
    const host = document.createElement("div");
    host.className = "ui-host";
    host.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;`;
    parent.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = window.UI_CSS[snap.cssRef] + "\n" + FREEZE;
    root.appendChild(style);
    const html = document.createElement("div");
    for (const [k, v] of Object.entries(snap.attrs)) if (k !== "class") html.setAttribute(k, v);
    html.className = `app-html ${snap.attrs.class || ""}`.trim();
    html.style.width = `${w}px`;
    html.style.height = `${h}px`;
    html.style.fontSize = snap.rootFont;
    const body = document.createElement("div");
    for (const [k, v] of Object.entries(snap.bodyAttrs)) if (k !== "class") body.setAttribute(k, v);
    body.className = `app-body ${snap.bodyAttrs.class || ""}`.trim();
    body.innerHTML = snap.html;
    html.appendChild(body);
    root.appendChild(html);
    const scrolls = [...root.querySelectorAll("[data-film-scroll]")].map((e) => {
      const [top, left] = e.getAttribute("data-film-scroll").split(",").map(Number);
      return { e, top, left };
    });
    const ui = {
      host, root, html, body, snap, w, h,
      $: (s) => root.querySelector(s),
      $$: (s) => [...root.querySelectorAll(s)],
      // scroll offsets do not survive serialisation or display: none, so they are set again on every frame
      keepScroll() {
        for (const s of scrolls) {
          if (s.e.scrollTop !== s.top) s.e.scrollTop = s.top;
          if (s.e.scrollLeft !== s.left) s.e.scrollLeft = s.left;
        }
      },
      // an element's box in snapshot pixels (call while the host is untransformed, e.g. while building)
      box(e) {
        const a = host.getBoundingClientRect(), b = e.getBoundingClientRect();
        const k = a.width / w;
        return { x: (b.left - a.left) / k, y: (b.top - a.top) / k, w: b.width / k, h: b.height / k, cx: (b.left - a.left + b.width / 2) / k, cy: (b.top - a.top + b.height / 2) / k };
      },
      images: () => [...root.querySelectorAll("img")],
      // the first element matching `sel` whose text contains `text`
      byText(sel, text) {
        return [...root.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
      },
      // a palette as the app writes it on <html>: data-theme and the --palette-* variables
      palette(p) {
        html.setAttribute("data-theme", p.theme);
        for (const decl of p.style.split(";")) {
          const i = decl.indexOf(":");
          if (i > 0) html.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
        }
      },
    };
    return ui;
  };
})();
