/** Export the application's icon geometry as standalone branding assets. */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { ICON_PATHS } from "../src/icons/paths.ts";

const output = new URL("../../../branding/icons/", import.meta.url);
const check = process.argv.includes("--check");
const mismatches = [];

if (!check) await mkdir(output, { recursive: true });

for (const [name, paths] of Object.entries(ICON_PATHS).sort(([a], [b]) => a.localeCompare(b, "en"))) {
  const filename = `${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}.svg`;
  const title = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">',
    `  <title>${title}</title>`,
    ...paths.map((path) => `  <path d="${path}"/>`),
    "</svg>",
    "",
  ].join("\n");
  const destination = new URL(filename, output);

  if (check) {
    const existing = await readFile(destination, "utf8").catch(() => null);
    if (existing !== svg) mismatches.push(filename);
  } else {
    await writeFile(destination, svg);
  }
}

if (mismatches.length > 0) {
  throw new Error(`Brand icons need exporting: ${mismatches.join(", ")}`);
}

console.log(`[icons] ${check ? "Verified" : "Exported"} ${Object.keys(ICON_PATHS).length} SVG files in branding/icons.`);
