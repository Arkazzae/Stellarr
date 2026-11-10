import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./detectLanguage", () => ({ detectLanguage: vi.fn() }));

interface WorkerRequest {
  type: string;
  id: number;
  text: string;
  from: string;
  to: string;
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;

  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }

  postMessage(request: WorkerRequest) {
    this.requests.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  /** Answers the request at `index` the way public/bergamot-worker.js does. */
  answer(index: number, translation: string) {
    this.onmessage?.({
      data: { type: "result", id: this.requests[index]!.id, translation },
    } as MessageEvent);
  }

  fail(index: number, message: string) {
    this.onmessage?.({
      data: { type: "error", id: this.requests[index]!.id, message },
    } as MessageEvent);
  }
}

// Both modules keep their queue and worker in module state.
async function loadTranslate(detected: string) {
  vi.resetModules();
  const { detectLanguage } = await import("./detectLanguage");
  vi.mocked(detectLanguage).mockReset().mockResolvedValue(detected);
  return { ...(await import("./translate")), detectLanguage: vi.mocked(detectLanguage) };
}

const worker = (index = 0) => FakeWorker.instances[index]!;

describe("translate", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the trimmed text to the worker with the detected source and caches the answer", async () => {
    const { translate, detectLanguage } = await loadTranslate("pl");

    const first = translate("  Dzień dobry\n", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    expect(worker().url).toBe("/bergamot-worker.js");
    expect(worker().requests[0]).toMatchObject({
      type: "translate",
      text: "Dzień dobry",
      from: "pl",
      to: "en",
    });
    worker().answer(0, "Good morning");

    await expect(first).resolves.toBe("Good morning");
    await expect(translate("Dzień dobry", "en")).resolves.toBe("Good morning");
    expect(worker().requests).toHaveLength(1);
    expect(detectLanguage).toHaveBeenCalledTimes(1);
  });

  it("does not hand out a translation cached for another target language", async () => {
    const { translate } = await loadTranslate("pl");

    const english = translate("Dzień dobry", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    worker().answer(0, "Good morning");
    await english;

    // The text is already Polish, so it comes back as it is rather than as the English entry.
    await expect(translate("Dzień dobry", "pl")).resolves.toBe("Dzień dobry");
  });

  it("returns whitespace-only text untouched without any work", async () => {
    const { translate, detectLanguage } = await loadTranslate("en");

    await expect(translate(" \n ", "en")).resolves.toBe(" \n ");

    expect(detectLanguage).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("keeps text that is already in the target language", async () => {
    const { translate } = await loadTranslate("en");

    await expect(translate("Good morning", "en")).resolves.toBe("Good morning");

    expect(FakeWorker.instances).toHaveLength(0);
  });

  it.each([
    { target: "en", assumed: "pl" },
    { target: "pl", assumed: "en" },
  ] as const)(
    "assumes $assumed as the source of a text for $target that cannot be identified",
    async ({ target, assumed }) => {
      const { translate } = await loadTranslate("und");

      void translate("???", target);

      await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
      expect(worker().requests[0]).toMatchObject({ from: assumed, to: target });
    },
  );

  it("rejects with the worker's message and does not cache the failure", async () => {
    const { translate } = await loadTranslate("pl");

    const failed = translate("Dzień dobry", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    worker().fail(0, "No model available for language pair: plen");
    await expect(failed).rejects.toThrow("No model available for language pair: plen");

    const retry = translate("Dzień dobry", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(2));
    worker().answer(1, "Good morning");
    await expect(retry).resolves.toBe("Good morning");
  });

  it("fails the running job when the worker crashes and starts a new worker afterwards", async () => {
    const { translate } = await loadTranslate("pl");

    const crashed = translate("Dzień dobry", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    worker().onerror?.({ message: "out of memory" } as ErrorEvent);

    await expect(crashed).rejects.toThrow("out of memory");
    expect(worker().terminated).toBe(true);

    void translate("Dobry wieczór", "en");
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    expect(worker(1).requests).toHaveLength(1);
  });

  it("gives up waiting after a timeout but leaves the worker running", async () => {
    vi.useFakeTimers();
    const { translate } = await loadTranslate("pl");

    const slow = translate("Dzień dobry", "en");
    const outcome = expect(slow).rejects.toThrow("Translation timed out");
    await vi.advanceTimersByTimeAsync(90_000);
    await outcome;
    expect(worker().terminated).toBe(false);

    // The slow answer arrives eventually and must not disturb the next job.
    const next = translate("Dobry wieczór", "en");
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker().requests).toHaveLength(2);
    worker().answer(0, "Good morning");
    worker().answer(1, "Good evening");
    await expect(next).resolves.toBe("Good evening");
  });

  it("lets identical concurrent requests share one job", async () => {
    const { translate } = await loadTranslate("pl");

    const first = translate("Dzień dobry", "en");
    const second = translate("Dzień dobry", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    worker().answer(0, "Good morning");

    await expect(Promise.all([first, second])).resolves.toEqual(["Good morning", "Good morning"]);
    expect(worker().requests).toHaveLength(1);
  });

  it("runs one job at a time and lets a priority request go first", async () => {
    const { translate } = await loadTranslate("pl");

    const running = translate("pierwszy", "en");
    const later = translate("drugi", "en");
    const urgent = translate("pilny", "en", { priority: true });
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    expect(worker().requests.map((request) => request.text)).toEqual(["pierwszy"]);

    worker().answer(0, "first");
    await running;
    await vi.waitFor(() => expect(worker().requests).toHaveLength(2));
    worker().answer(1, "urgent");
    await urgent;
    await vi.waitFor(() => expect(worker().requests).toHaveLength(3));
    worker().answer(2, "second");
    await later;

    expect(worker().requests.map((request) => request.text)).toEqual([
      "pierwszy",
      "pilny",
      "drugi",
    ]);
  });

  it("cancels jobs that have not started but lets the running one finish", async () => {
    const { translate, cancelPending, TranslationCancelledError } = await loadTranslate("pl");

    const running = translate("pierwszy", "en");
    const queued = translate("drugi", "en");
    await vi.waitFor(() => expect(worker().requests).toHaveLength(1));
    cancelPending();

    await expect(queued).rejects.toBeInstanceOf(TranslationCancelledError);
    worker().answer(0, "first");
    await expect(running).resolves.toBe("first");
    expect(worker().requests).toHaveLength(1);
  });
});
