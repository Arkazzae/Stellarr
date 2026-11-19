/**
 * The suppressor record: each engine's binary, through the worklet's own
 * wrapper, held to web/bench/voice/records/suppressor/<engine>.txt. Any
 * change in what it outputs fails here, however small, until the record is
 * rewritten on purpose (npm run voice:record). See web/bench/voice/README.md.
 */
import { describe, expect, it } from "vitest";

import { checkEngine, explain, type EngineName } from "../../../../../bench/voice/suppressor/record";

const ENGINE_LABELS: ReadonlyArray<readonly [string, EngineName]> = [
  ["Speex", "speex"],
  ["RNNoise", "rnnoise"],
  ["GTCRN", "gtcrn"],
];

describe("suppressor record", () => {
  for (const [label, engine] of ENGINE_LABELS) {
    it(
      `${label} puts out what it is recorded to on every fixture`,
      (context) => {
        const outcome = checkEngine(engine);
        // A run with STELLARR_VOICE_RECORD=1 writes the record; it is reported
        // as skipped, never as passed.
        if (outcome.written) context.skip(`recorded ${outcome.name}`);
        expect(outcome.problems, explain(outcome)).toEqual([]);
      },
      180_000,
    );
  }
});
