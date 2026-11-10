/**
 * Copies the noise-suppression worklets and WASM binaries out of
 * `@sapphi-red/web-noise-suppressor` into `public/audio/`.
 *
 * `AudioWorklet.addModule` and `WebAssembly.instantiate` need a real URL, so
 * these files cannot go through the bundler. Copying them from node_modules
 * keeps them in step with the locked package version, and serving them from
 * our own origin keeps a third-party CDN out of the audio path.
 *
 * Runs from the `predev`, `prebuild` and `pretest` npm hooks, so a plain
 * `npm ci && npm run build` picks them up.
 */
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const targetDir = fileURLToPath(new URL("../public/audio/", import.meta.url));

const PACKAGE = "@sapphi-red/web-noise-suppressor";

/** Package file name -> name it is served under. */
const ASSETS = {
  "rnnoiseWorklet.js": "rnnoise-worklet.js",
  "rnnoise.wasm": "rnnoise.wasm",
  "rnnoise_simd.wasm": "rnnoise_simd.wasm",
  "gtcrnWorklet.js": "gtcrn-worklet.js",
  "gtcrn.wasm": "gtcrn.wasm",
  "speexWorklet.js": "speex-worklet.js",
  "speex.wasm": "speex.wasm",
};

/**
 * Writes through a temporary sibling and renames it into place. The Docker dev
 * service creates these files as root in a bind-mounted directory, so reopening
 * one for writing from the host fails with EACCES while replacing the directory
 * entry still works. The rename also never exposes a half-written asset.
 */
function copyAsset(source, name) {
  const temporary = join(targetDir, `.${name}.${process.pid}.tmp`);
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, join(targetDir, name));
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

mkdirSync(targetDir, { recursive: true });

let copied = 0;
for (const [file, name] of Object.entries(ASSETS)) {
  const specifier = `${PACKAGE}/${file}`;
  try {
    copyAsset(require.resolve(specifier), name);
    copied += 1;
  } catch (error) {
    // The app falls back to browser noise suppression and says so in the
    // settings, so a missing asset must not fail the build.
    console.warn(`[audio-assets] could not copy ${specifier}: ${error.message}`);
  }
}

console.log(`[audio-assets] ${copied}/${Object.keys(ASSETS).length} copied to public/audio`);
