import "fake-indexeddb/auto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  downloadModel,
  getModelStatus,
  getPairSize,
  primaryPair,
} from "./modelStatus";

const files = {
  model: { name: "model.bin", size: 5 },
  lex: { name: "lex.bin", size: 3 },
  vocab: { name: "vocab.spm", size: 4 },
} as const;

const payloads: Record<string, Uint8Array> = {
  "model.bin": new Uint8Array([1, 2, 3, 4, 5]),
  "lex.bin": new Uint8Array([6, 7, 8]),
  "vocab.spm": new Uint8Array([9, 10, 11, 12]),
};

function removeModelDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("bergamot-models");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

describe("Bergamot model loading", () => {
  beforeAll(async () => {
    await removeModelDatabase();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/bergamot-models/registry.json") {
          return Response.json({ plen: files, enpl: files });
        }

        // Production tries a bundled model first and uses the same-origin GCS
        // proxy when it is not part of the application image.
        if (url.startsWith("/bergamot-models/")) {
          return new Response(null, { status: 404 });
        }

        const name = url.split("/").at(-1) ?? "";
        const payload = payloads[name];
        return payload === undefined
          ? new Response(null, { status: 404 })
          : new Response(payload.slice().buffer as ArrayBuffer, { status: 200 });
      }),
    );
  });

  it("maps both targets to a real direct model", () => {
    expect(primaryPair("en")).toBe("plen");
    expect(primaryPair("pl")).toBe("enpl");
  });

  it("streams a missing model into IndexedDB and reuses it without network", async () => {
    const progress: number[] = [];

    expect(await getModelStatus("en")).toBe("not-downloaded");
    expect(await getPairSize("en")).toBe(12);

    await downloadModel("en", (value) => progress.push(value));

    expect(progress.at(-1)).toBe(100);
    expect(progress.some((value) => value > 0 && value < 100)).toBe(true);
    expect(await getModelStatus("en")).toBe("ready");

    const fetchMock = vi.mocked(fetch);
    const callsAfterFirstDownload = fetchMock.mock.calls.length;
    await downloadModel("en");

    expect(fetchMock).toHaveBeenCalledWith("/bergamot-models/plen/model.bin");
    expect(fetchMock).toHaveBeenCalledWith("/bergamot-models-gcs/plen/model.bin");
    expect(fetchMock.mock.calls).toHaveLength(callsAfterFirstDownload);
  });
});
