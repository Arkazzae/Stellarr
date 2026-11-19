/**
 * Where the browser loads the GTCRN worklet from.
 *
 * `?worker&url` makes Vite bundle `processor.ts` on its own, with everything
 * it imports and nothing of the app's, and hand back the address of that
 * file. web/worklets.ts names the file /audio/gtcrn-worklet.js in the
 * build; the dev server serves the source module itself.
 */
import gtcrnWorklet from "./processor?worker&url";

export const GTCRN_WORKLET_URL: string = gtcrnWorklet;
