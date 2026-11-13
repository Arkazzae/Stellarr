/**
 * Check that @stellarr/ui and the apps agree on the --ui-* custom properties.
 *
 * A custom property fails silently: a required token an app forgot makes the
 * declaration that reads it invalid, and a mistyped optional token is never read,
 * so the part quietly keeps its default look. This turns both into a failed check.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const packageDir = "packages/stellarr-ui";
const apps = ["cockpit", "web"];
const prefix = "--ui-";

const read = (file) => readFileSync(join(root, file), "utf8");
const lineOf = (css, index) => css.slice(0, index).split("\n").length;

/** Blank out comments, keeping every offset and line number as it was. */
function withoutComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** The CSS files under `dir`, as `{ file, css }` with the comments blanked. */
function loadCss(dir) {
  return readdirSync(join(root, dir), { recursive: true })
    .filter((name) => name.endsWith(".css"))
    .sort()
    .map((name) => ({ file: join(dir, name), css: withoutComments(read(join(dir, name))) }));
}

/** The index of the parenthesis that closes the one at `open`. */
function closingParen(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "(") depth++;
    else if (css[i] === ")" && --depth === 0) return i;
  }
  return css.length;
}

/**
 * Every `var(--ui-*)` in `css` and whether it names a fallback. A nested `var()`
 * is found on its own, so the one in `var(--ui-a, var(--ui-b))` has none.
 */
function findReads(css) {
  const reads = [];
  for (const { index } of css.matchAll(/(?<![\w-])var\(/g)) {
    const open = index + "var".length;
    const inner = css.slice(open + 1, closingParen(css, open));
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    if (name.startsWith(prefix)) reads.push({ name, fallback: comma >= 0, index });
  }
  return reads;
}

/** Every `--ui-*: value` declaration in `css`. */
function findDefinitions(css) {
  return [...css.matchAll(/(--ui-[a-z0-9-]+)\s*:/g)].map((match) => ({ name: match[1], index: match.index }));
}

/** What the package reads, as a map from token to whether it is required. */
function packageTokens() {
  const tokens = new Map();
  for (const { css } of loadCss(`${packageDir}/src`)) {
    for (const { name, fallback } of findReads(css)) {
      tokens.set(name, tokens.get(name) || !fallback);
    }
  }
  return tokens;
}

/** The problems with one app's tokens, and how many distinct tokens it defines. */
function checkApp(app, tokens) {
  const definitions = [];
  const reads = [];
  for (const { file, css } of loadCss(`${app}/src`)) {
    const where = (index) => `${file}:${lineOf(css, index)}`;
    for (const { name, index } of findDefinitions(css)) definitions.push({ name, at: where(index) });
    for (const { name, index } of findReads(css)) reads.push({ name, at: where(index) });
  }
  const defined = new Set(definitions.map(({ name }) => name));
  const problems = [];

  for (const [name, required] of tokens) {
    if (required && !defined.has(name)) problems.push(`${name} is required by @stellarr/ui and not defined`);
  }
  for (const { name, at } of definitions) {
    if (!tokens.has(name)) problems.push(`${at}: ${name} is defined, but @stellarr/ui never reads it`);
  }
  for (const { name, at } of reads) {
    if (!tokens.has(name) && !defined.has(name)) {
      problems.push(`${at}: var(${name}) reads a token that neither @stellarr/ui nor the app defines`);
    }
  }
  return { problems, defined: defined.size };
}

/** The tokens the package reads that its README does not name. */
function undocumented(tokens) {
  // Exact names, so `--ui-button-gap` is not found inside `--ui-button-gap-x`.
  const documented = new Set(read(`${packageDir}/README.md`).match(/--ui-[a-z0-9-]+/g));
  return [...tokens.keys()].filter((name) => !documented.has(name));
}

const tokens = packageTokens();
const groups = [];
const defined = [];

for (const app of apps) {
  const result = checkApp(app, tokens);
  groups.push([app, result.problems]);
  defined.push(`${app} defines ${result.defined}`);
}
groups.push([
  `${packageDir}/README.md`,
  undocumented(tokens).map((name) => `${name} is read by @stellarr/ui and not mentioned`),
]);

const failed = groups.filter(([, problems]) => problems.length > 0);
for (const [title, problems] of failed) {
  console.error(`[tokens] ${title}`);
  for (const problem of problems) console.error(`  ${problem}`);
}
if (failed.length > 0) {
  process.exitCode = 1;
} else {
  const required = [...tokens.values()].filter(Boolean).length;
  console.log(
    `[tokens] Verified ${required} required and ${tokens.size - required} optional tokens; ${defined.join(", ")}.`,
  );
}
