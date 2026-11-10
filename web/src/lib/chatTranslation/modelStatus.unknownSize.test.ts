import "fake-indexeddb/auto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { downloadModel, getModelStatus } from "./modelStatus";

// A listed size of 0 means the registry does not know the size of the file.
const registry = {
  plen: {
    model: { name: "model.bin", size: 5 },
    lex: { name: "lex.bin", size: 0 },
    vocab: { name: "vocab.spm", size: 4 },
  },
};

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

describe("Bergamot model loading with a file of unknown size", () => {
  beforeAll(async () => {
    await removeModelDatabase();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/bergamot-models/registry.json") return Response.json(registry);

        const payload = payloads[url.split("/").at(-1) ?? ""];
        return payload === undefined
          ? new Response(null, { status: 404 })
          : new Response(payload.slice().buffer as ArrayBuffer, { status: 200 });
      }),
    );
  });

  it("stores the file without comparing it to a size", async () => {
    await expect(downloadModel("en")).resolves.toBeUndefined();

    expect(await getModelStatus("en")).toBe("ready");
  });
});
