import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

import type * as Router from "@stellarr/router";
import type { Route } from "@stellarr/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rollup } from "vite";

import {
  BUILD_DIRECTORY,
  CATALOG_MODULES,
  chosenPreloadScript,
  COCKPIT_DOCUMENT,
  documentFor,
  earlyPreloadScript,
  fileDirectories,
  mergeSlashes,
  PRE_PAINT_MARKER,
  PRELOAD_CHOSEN_MARKER,
  PRELOAD_MARKER,
  preloadPlan,
  requestPath,
  WEB_DOCUMENT,
  writePrePaint,
  writePreload,
  type PreloadPlan,
} from "./documents";
import { RELEASE_PATH } from "./release";
import { THEME_SCRIPT } from "./src/stellarr/design/themeScript";
import { SUPPORTED_LOCALES, translateMessage } from "./src/stellarr/i18n";
import { LANGUAGE_SETTINGS_KEY } from "./src/stellarr/i18n/defaultLocale";
import {
  INSTANCE_LANGUAGE_GLOBAL,
  INSTANCE_LANGUAGE_PATH,
  instanceLanguageSource,
  LANGUAGE_HINT_KEY,
  LOCALE_SCRIPT,
} from "./src/stellarr/i18n/localeScript";
import { routes } from "./src/stellarr/routes";
import { WORKLETS } from "./worklets";

// The route table keeps its paths to itself, so the tables handed to
// defineRoutes are kept here, for the check against infra/nginx.conf.
const tables = vi.hoisted(() => [] as (readonly Route[])[]);
vi.mock("@stellarr/router", async (importOriginal) => {
  const router = await importOriginal<typeof Router>();
  return {
    ...router,
    defineRoutes: (table: Parameters<typeof router.defineRoutes>[0]) => {
      tables.push(table.routes);
      return router.defineRoutes(table);
    },
  };
});

const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), "utf8");
const directories = fileDirectories(fileURLToPath(here("public")));

describe("the addresses each document answers", () => {
  it("gives every address of the web client its document", () => {
    for (const path of ["/", "/login", "/reset-password", "/invite/abc123", "/invite/%E0%A4%A", "/nope", "/login/"]) {
      expect(documentFor(path, directories), path).toBe(WEB_DOCUMENT);
    }
  });

  it("counts runs of slashes as one, as nginx does, in both apps", () => {
    for (const path of ["//", "//login", "//register", "//nope", "///invite//abc123", "//login/"]) {
      expect(documentFor(path, directories), path).toBe(WEB_DOCUMENT);
    }
    for (const path of ["//cockpit", "//cockpit//users", "/cockpit//users", "///cockpit/"]) {
      expect(documentFor(path, directories), path).toBe(COCKPIT_DOCUMENT);
    }
    expect(documentFor("//audio//missing.js", directories)).toBeNull();
    expect(mergeSlashes("//cockpit//users//")).toBe("/cockpit/users/");
    expect(mergeSlashes("/")).toBe("/");
  });

  it("reads a request's address as a path, however many slashes lead it", () => {
    expect(requestPath("//")).toBe("//");
    expect(requestPath("//login?x=1")).toBe("//login");
    expect(requestPath("///cockpit//users")).toBe("///cockpit//users");
    expect(requestPath("/stellarr-instance.js")).toBe("/stellarr-instance.js");
    // A target that makes no address is left to the server's own handling.
    expect(requestPath("@")).toBeNull();
  });

  it("merges a long run of slashes in time linear in its length", () => {
    const run = "/".repeat(300_000);
    const started = performance.now();

    expect(mergeSlashes(`${run}login`)).toBe("/login");
    expect(documentFor(`${run}cockpit${run}users`, directories)).toBe(COCKPIT_DOCUMENT);

    expect(performance.now() - started).toBeLessThan(250);
  });

  it("gives /cockpit and everything below it Cockpit's document", () => {
    for (const path of ["/cockpit", "/cockpit/", "/cockpit/users", "/cockpit/nope/deeper"]) {
      expect(documentFor(path, directories), path).toBe(COCKPIT_DOCUMENT);
    }
    expect(documentFor("/cockpits", directories)).toBe(WEB_DOCUMENT);
  });

  it("never answers a file with a document, so a missing one is a 404", () => {
    for (const path of [
      "/audio/missing-worklet.js",
      "/codecs/missing.wasm",
      "/bergamot-models/plen/missing",
      "/fonts/missing",
      "/sounds/missing",
      "/identity/avatars/missing.webp",
      `/${BUILD_DIRECTORY}/missing`,
      "/missing.js",
      "/cockpit/missing.css",
      "/@vite/client",
    ]) {
      expect(documentFor(path, directories), path).toBeNull();
    }
  });

  it("counts every top-level folder of public/ and the build's own as files", () => {
    expect(directories).toEqual(expect.arrayContaining(["audio", "bergamot-models", "fonts", "identity", "sounds", "static"]));
    expect(BUILD_DIRECTORY).not.toBe("assets");
  });
});

describe("the web client's document", () => {
  const html = writePrePaint(read("index.html"));
  const head = html.slice(0, html.indexOf("</head>"));

  it("runs the instance file, the locale script and the theme script in <head>, in that order", () => {
    const instance = head.indexOf(`<script src="${INSTANCE_LANGUAGE_PATH}"`);
    const locale = head.indexOf(LOCALE_SCRIPT);
    const theme = head.indexOf(THEME_SCRIPT);

    expect(instance).toBeGreaterThan(0);
    expect(locale).toBeGreaterThan(instance);
    expect(theme).toBeGreaterThan(locale);
    expect(html).not.toContain(PRE_PAINT_MARKER);
  });

  it("puts the description before the script that translates it", () => {
    expect(head.indexOf('<meta name="description"')).toBeLessThan(head.indexOf(LOCALE_SCRIPT));
    expect(head).toContain(`content="${translateMessage("en", "app.description")}"`);
  });

  it("refuses a document that lost its marker", () => {
    expect(() => writePrePaint("<head></head>")).toThrow(/pre-paint/);
    expect(() => writePreload("<head></head>", null)).toThrow(/preload/);
  });

  it("keeps a place for one preload script ahead of the instance file and one after the locale script", () => {
    const early = head.indexOf(PRELOAD_MARKER);
    const chosen = head.indexOf(PRELOAD_CHOSEN_MARKER);

    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(head.indexOf(`<script src="${INSTANCE_LANGUAGE_PATH}"`));
    expect(chosen).toBeGreaterThan(head.indexOf(LOCALE_SCRIPT));
    expect(chosen).toBeGreaterThan(head.indexOf(THEME_SCRIPT));
  });

  it("gets the preload scripts from the build, and none from the dev server", () => {
    const plan: PreloadPlan = { catalogs: { pl: ["/static/pl-1.js"], en: ["/static/en-1.js"] } };

    const built = writePreload(html, plan);
    expect(built).toContain(`<script>${earlyPreloadScript(plan)}</script>`);
    expect(built).toContain(`<script>${chosenPreloadScript(plan)}</script>`);
    expect(built).not.toContain(PRELOAD_MARKER);
    expect(built).not.toContain(PRELOAD_CHOSEN_MARKER);

    const dev = writePreload(html, null);
    expect(dev).not.toContain(PRELOAD_MARKER);
    expect(dev).not.toContain(PRELOAD_CHOSEN_MARKER);
    expect(dev).not.toContain("modulepreload");
  });

  it("carries the metadata the app had", () => {
    expect(head).toContain("<title>Stellarr</title>");
    expect(head).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(head).toContain('<meta name="theme-color" content="#111111" />');
    expect(head).toContain("width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover");
    expect(head).toContain('<link rel="icon" href="/src/stellarr/assets/icon.svg"');
  });
});

/** A chunk of a build, as the bundle describes it to the plugin. */
function chunk(fileName: string, module: string | null, imports: string[] = []) {
  return { type: "chunk", fileName, facadeModuleId: module === null ? null : `/repo/web/${module}`, imports };
}

function bundleOf(...chunks: ReturnType<typeof chunk>[]): Rollup.OutputBundle {
  return Object.fromEntries(chunks.map((item) => [item.fileName, item])) as unknown as Rollup.OutputBundle;
}

const ENTRY = "static/web-1.js";

describe("what the document fetches ahead of the entry", () => {
  const build = bundleOf(
    chunk(ENTRY, "src/stellarr/main.tsx", ["static/src-1.js"]),
    chunk("static/src-1.js", null),
    chunk("static/pl-1.js", CATALOG_MODULES.pl),
    chunk("static/en-1.js", CATALOG_MODULES.en),
  );

  it("is each catalog's chunk", () => {
    expect(preloadPlan(build, ENTRY)).toEqual({
      catalogs: { pl: ["/static/pl-1.js"], en: ["/static/en-1.js"] },
    });
  });

  it("refuses a build whose entry carries a catalog again", () => {
    const merged = bundleOf(
      chunk(ENTRY, "src/stellarr/main.tsx", ["static/src-1.js"]),
      chunk("static/src-1.js", CATALOG_MODULES.en),
      chunk("static/pl-1.js", CATALOG_MODULES.pl),
    );

    expect(() => preloadPlan(merged, ENTRY)).toThrow(/which the entry loads anyway/);
  });

  it("refuses a build with no chunk of its own for a catalog", () => {
    const missing = bundleOf(chunk(ENTRY, "src/stellarr/main.tsx"), chunk("static/pl-1.js", CATALOG_MODULES.pl));

    expect(() => preloadPlan(missing, ENTRY)).toThrow(/no chunk of its own/);
  });

  it("refuses catalogs that share a chunk, since a page would fetch both", () => {
    const shared = bundleOf(
      chunk(ENTRY, "src/stellarr/main.tsx"),
      chunk("static/pl-1.js", CATALOG_MODULES.pl, ["static/words-1.js"]),
      chunk("static/en-1.js", CATALOG_MODULES.en, ["static/words-1.js"]),
      chunk("static/words-1.js", null),
    );

    expect(() => preloadPlan(shared, ENTRY)).toThrow(/share a chunk/);
  });
});

describe("the preload scripts", () => {
  const plan: PreloadPlan = {
    catalogs: { pl: ["/static/pl-1.js"], en: ["/static/en-1.js"] },
  };
  const preloaded = () =>
    [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')].map(
      (link) => link.getAttribute("href") ?? "",
    );

  /**
   * Runs the head's scripts in the document's order on a page at `path`: the
   * first preload script, the instance file, the locale script, the second
   * preload script. Returns what the first asked for and what both did.
   */
  function load(path: string, instanceLanguage: string | null) {
    window.history.replaceState(null, "", path);
    new Function(earlyPreloadScript(plan))();
    const early = preloaded();
    (0, eval)(instanceLanguageSource(instanceLanguage));
    (0, eval)(LOCALE_SCRIPT);
    new Function(chosenPreloadScript(plan))();
    return { early, all: preloaded() };
  }

  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = "";
  });

  afterEach(() => {
    document.head.innerHTML = "";
    delete (window as Window & { [INSTANCE_LANGUAGE_GLOBAL]?: unknown })[INSTANCE_LANGUAGE_GLOBAL];
    window.history.replaceState(null, "", "/");
  });

  it("on a browser's first load, wait for the instance file and fetch only the chosen language", () => {
    expect(load("/login", "en")).toEqual({ early: [], all: ["/static/en-1.js"] });
    // Fetched the way the entry's script tag fetches, so its import takes the module.
    expect(document.head.querySelector('link[rel="modulepreload"]')?.getAttribute("crossorigin")).toBe("");
    document.head.innerHTML = "";
    localStorage.clear();
    expect(load("/register", "pl")).toEqual({ early: [], all: ["/static/pl-1.js"] });
  });

  it("on the next load, ask for the same language ahead of the instance file, once", () => {
    load("/login", "pl");
    document.head.innerHTML = "";

    expect(load("/login", "pl")).toEqual({ early: ["/static/pl-1.js"], all: ["/static/pl-1.js"] });
  });

  it("ask early for the language the person chose, whatever the instance says", () => {
    localStorage.setItem(LANGUAGE_SETTINGS_KEY, JSON.stringify({ locale: "en" }));
    localStorage.setItem(LANGUAGE_HINT_KEY, "pl");

    expect(load("/login", "pl")).toEqual({ early: ["/static/en-1.js"], all: ["/static/en-1.js"] });
    expect(document.documentElement.lang).toBe("en");
  });

  it("fetch the new default too on the one load after the operator changes it, and paint in it", () => {
    load("/login", "en");
    document.head.innerHTML = "";

    expect(load("/login", "pl")).toEqual({ early: ["/static/en-1.js"], all: ["/static/en-1.js", "/static/pl-1.js"] });
    expect(document.documentElement.lang).toBe("pl");

    document.head.innerHTML = "";
    expect(load("/login", "pl").all).toEqual(["/static/pl-1.js"]);
  });
});

describe("Cockpit's document", () => {
  const html = read(COCKPIT_DOCUMENT);

  it("carries none of the web client's scripts", () => {
    expect(html).not.toContain(PRE_PAINT_MARKER);
    expect(html).not.toContain(INSTANCE_LANGUAGE_PATH);
    expect(html).toContain('<script type="module" src="/src/cockpit/main.tsx"></script>');
  });

  it("carries the metadata the panel had", () => {
    expect(html).toContain("<title>Stellarr Cockpit</title>");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#1b1b1f"');
  });
});

interface MapEntry {
  readonly key: string;
  readonly value: string;
}

/** The entries of `map $uri $stellarr_address` in infra/nginx.conf, in their order. */
function addressMap(config: string): MapEntry[] {
  const block = /map \$uri \$stellarr_address \{\n([\s\S]*?)\n\s*\}/.exec(config)?.[1];
  if (block === undefined) throw new Error("infra/nginx.conf has no map $uri $stellarr_address.");
  return [...block.matchAll(/^\s*("[^"]*"|[^\s#]\S*)\s+(\S+);/gm)].map(([, key = "", value = ""]) => ({
    key: key.replace(/^"(.*)"$/, "$1"),
    value,
  }));
}

/** What nginx's map gives `uri`: an exact key first, then the first regex that matches, then the default. */
function lookUp(entries: readonly MapEntry[], uri: string): string | undefined {
  const exact = entries.find(({ key }) => key !== "default" && !key.startsWith("~") && key === uri);
  const regex = entries.find(({ key }) => key.startsWith("~") && new RegExp(key.slice(1)).test(uri));
  return (exact ?? regex ?? entries.find(({ key }) => key === "default"))?.value;
}

/** A route's path with every parameter as `:`, the form both lists are compared in. */
const routeShape = (path: string) => path.replace(/:[A-Za-z_]\w*/g, ":");

/** A page's regex in nginx's map in that form: `~^/invite/[^/]+/?$` is `/invite/:`. */
const nginxShape = (key: string) =>
  key.replace(/^~\^/, "").replace(/\$$/, "").replace(/\/\?$/, "").replaceAll("[^/]+", ":");

/** Addresses of that form, with and without a trailing slash. */
function addressesOf(shape: string): string[] {
  const address = shape.replaceAll(":", "abc123");
  return address === "/" ? [address] : [address, `${address}/`];
}

/** What answers an address that names no file, as documents.ts and the web client's routes decide. */
function expectedAnswer(address: string): string {
  const document = documentFor(address, directories);
  if (document === null) return "file";
  if (document === COCKPIT_DOCUMENT) return "cockpit";
  return routes.claims(address) ? "page" : "missing";
}

describe("infra/nginx.conf, which serves the build in the container", () => {
  const entries = addressMap(read("../infra/nginx.conf"));
  const pages = entries.filter(({ value }) => value === "page").map(({ key }) => nginxShape(key));
  const routePaths = tables.flatMap((table) => table.map(({ path }) => routeShape(path)));

  it("lists the web client's addresses as its route table does", () => {
    expect(tables).toHaveLength(1);
    expect(routePaths.length).toBeGreaterThan(0);
    expect([...pages].sort()).toEqual([...routePaths].sort());
  });

  it("counts as files the folders documents.ts does", () => {
    expect(entries).toContainEqual({ key: `~^/(${directories.join("|")})(/|$)`, value: "file" });
  });

  it("answers every address that names no file as documents.ts and the route table do", () => {
    const addresses = [
      ...[...pages, ...routePaths].flatMap(addressesOf),
      ...directories.flatMap((directory) => [`/${directory}`, `/${directory}/`, `/${directory}/missing`]),
      "/cockpit",
      "/cockpit/",
      "/cockpit/users",
      "/cockpit/nope/deeper",
      "/cockpit/missing.css",
      "/cockpits",
      "/nope",
      "/nope/",
      "/invite",
      "/invite/abc123/more",
      "/invite/abc.123",
      "/login/more",
      "/missing.js",
    ];
    for (const address of addresses) {
      expect(lookUp(entries, address), address).toBe(expectedAnswer(address));
    }
  });

  it("counts an address as a file by a dot in its last segment only", () => {
    const cases: [address: string, answer: string][] = [
      ["/missing.js", "file"],
      ["/web-abc.js.gz", "file"],
      ["/static/web-abc.js.gz", "file"],
      ["/a.b.c", "file"],
      ["/nope/a..b", "file"],
      ["/a.", "file"],
      ["/nope/b.", "file"],
      // A dot in an earlier segment only, or a trailing slash after one.
      ["/v1.2/users", "missing"],
      ["/a.b/", "missing"],
      ["/a.b.c/", "missing"],
      ["/invite/abc.123/", "page"],
    ];
    for (const [address, answer] of cases) {
      expect(lookUp(entries, address), address).toBe(answer);
      expect(expectedAnswer(address), address).toBe(answer);
    }
  });

  // [^/]* after the dot would rescan the rest of the segment from every dot:
  // 50,000 dots before a slash took seven seconds to match.
  // nginx merges the slashes of an address (merge_slashes) before the map
  // sees $uri, and the router merges them before it picks the page, so an
  // address that starts with two slashes gets the page it names.
  it("answers an address with runs of slashes as nginx does once it merged them", () => {
    for (const address of [
      "//",
      "//login",
      "//register",
      "//nope",
      "//login/",
      "///invite//abc123",
      "//cockpit",
      "//cockpit//users",
      "/cockpit//users",
      "//missing.js",
      "//audio//missing",
    ]) {
      expect(lookUp(entries, mergeSlashes(address)), address).toBe(expectedAnswer(address));
    }
    expect(expectedAnswer("//login")).toBe("page");
    expect(expectedAnswer("//nope")).toBe("missing");
    expect(expectedAnswer("//cockpit//users")).toBe("cockpit");
  });

  it("answers a long run of dots before a slash in time linear in its length", () => {
    const address = `/${".".repeat(50_000)}/`;
    const started = performance.now();

    expect(lookUp(entries, address)).toBe("missing");
    expect(expectedAnswer(address)).toBe("missing");

    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("the instance language file the container writes", () => {
  const entrypoint = read("../infra/entrypoint.sh");
  const writer = /^write_instance_language\(\) \{\n[\s\S]*?\n\}\n/m.exec(entrypoint)?.[0];

  /** Runs the entrypoint's writer under bash and returns the file it wrote. */
  function written(language: string | undefined): string {
    if (writer === undefined) throw new Error("infra/entrypoint.sh has no write_instance_language.");
    const directory = mkdtempSync(join(tmpdir(), "stellarr-instance-"));
    try {
      const file = join(directory, "stellarr-instance.js");
      const env = { ...process.env };
      delete env.STELLARR_LANGUAGE;
      if (language !== undefined) env.STELLARR_LANGUAGE = language;
      execFileSync("bash", ["-c", `${writer}\nwrite_instance_language "$1"`, "bash", file], { env, stdio: "ignore" });
      return readFileSync(file, "utf8");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("is written where nginx serves it from", () => {
    expect(entrypoint).toContain(`write_instance_language /run/stellarr${INSTANCE_LANGUAGE_PATH}\n`);
    expect(read("../infra/nginx.conf")).toMatch(
      new RegExp(`location = ${INSTANCE_LANGUAGE_PATH.replaceAll(".", "\\.")} \\{\\s*root /run/stellarr;`),
    );
  });

  it.each([...SUPPORTED_LOCALES, undefined, "", "de", "EN", " pl", 'pl";alert(1);"', "</script>"])(
    "holds the bytes of instanceLanguageSource for STELLARR_LANGUAGE=%j",
    (language) => {
      expect(written(language)).toBe(instanceLanguageSource(language));
    },
  );
});

/** The files of a source tree, test code left out. */
function sourceFiles(directory: string): string[] {
  return readdirSync(here(directory), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(ts|tsx|css)$/.test(file) && !/\.test\.tsx?$/.test(file) && !/(^|\/)test\//.test(file))
    .map((file) => `${directory}/${file}`);
}

describe("the files the apps name by address", () => {
  // A root-relative address in a string, a url() or an attribute, with the
  // extension of a file. The same sweep over the built files found /icon.svg,
  // which Next served from src/app/ and the static build does not have.
  const ADDRESS = /["'`(]\/[\w@./-]+\.(?:svg|png|jpe?g|webp|gif|ico|m?js|css|wasm|json|wav|mp3|ogg|opus|woff2?|ttf|bin|spm|txt|webmanifest|map|html)\b/g;
  const manifest = JSON.parse(read("../artifacts/manifest.json")) as { artifacts: { path: string }[] };
  const assembled = new Set(manifest.artifacts.map(({ path }) => `/${path}`));
  const sources = [
    ...sourceFiles("src"),
    ...["stellarr-ui", "stellarr-icons", "stellarr-router"].flatMap((name) => sourceFiles(`../packages/${name}/src`)),
    "index.html",
    "cockpit/index.html",
    "public/bergamot-worker.js",
  ];
  const named = new Map<string, string>();
  for (const source of sources) {
    for (const [match] of read(source).matchAll(ADDRESS)) named.set(match.slice(1), source);
  }

  /** Whether the instance serves `address`: a file of public/ or of the artifacts, the instance file, the release file, or a source the build turns into a file of its own. */
  function served(address: string): boolean {
    if (address === INSTANCE_LANGUAGE_PATH || address === RELEASE_PATH) return true;
    if (address.startsWith("/src/")) return existsSync(here(`.${address}`));
    if (Object.values(WORKLETS).some((file) => address === `/${file}`)) return true;
    return assembled.has(address) || existsSync(here(`public${address}`));
  }

  it("finds the addresses the apps load files from", () => {
    expect([...named.keys()]).toEqual(
      expect.arrayContaining(["/audio/gtcrn.wasm", "/sounds/calling.wav", "/fonts/outfit-100-900-latin.woff2"]),
    );
  });

  it("names only files the build or the instance serves", () => {
    const missing = [...named].filter(([address]) => !served(address)).map(([address, source]) => `${address} in ${source}`);
    expect(missing).toEqual([]);
  });
});

describe("the service worker, which tells the addresses of the web client apart", () => {
  const worker = { self: { addEventListener: () => undefined } } as unknown as {
    isWebAddress(pathname: string, directories: string[]): boolean;
  };
  runInNewContext(read("public/stellarr-worker.js"), worker);
  const directories = fileDirectories(fileURLToPath(here("public")));

  it.each([
    "/", "/login", "/login/", "/invite/abc", "/some/deep/page", "//login", "/cockpit", "/cockpit/users", "//cockpit//users/",
    "/static/web.js", "/fonts/outfit.woff2", "/audio/detector-worklet.js", "/sounds/a.wav", "/index.html", "/robots.txt", "/a.b/c", "/users/x.y",
  ])("answers %s as documentFor does", (pathname) => {
    expect(worker.isWebAddress(pathname, directories)).toBe(documentFor(pathname, directories) === WEB_DOCUMENT);
  });
});
