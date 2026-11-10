// Client for public/bergamot-worker.js: one worker, one request per message id.

const WORKER_URL = "/bergamot-worker.js";
const CALL_TIMEOUT_MS = 90_000;

interface WorkerReply {
  type: "result" | "error";
  id: number;
  translation?: string;
  message?: string;
}

interface PendingCall {
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let lastId = 0;
const pending = new Map<number, PendingCall>();

/** Stops the worker and fails what it was doing; the next call starts a fresh one. */
function discardWorker(reason: string): void {
  worker?.terminate();
  worker = null;
  const abandoned = [...pending.values()];
  pending.clear();
  for (const call of abandoned) {
    clearTimeout(call.timer);
    call.reject(new Error(reason));
  }
}

function handleReply({ data }: MessageEvent<WorkerReply>): void {
  const call = pending.get(data.id);
  if (call === undefined) return;
  pending.delete(data.id);
  clearTimeout(call.timer);
  if (data.type === "result" && typeof data.translation === "string") {
    call.resolve(data.translation);
  } else {
    call.reject(new Error(data.message ?? "Translation failed"));
  }
}

function activeWorker(): Worker {
  if (worker === null) {
    worker = new Worker(WORKER_URL);
    worker.onmessage = handleReply;
    worker.onerror = (event) => discardWorker(event.message || "Translation worker failed");
    worker.onmessageerror = () => discardWorker("Translation worker returned invalid data");
  }
  return worker;
}

export function runInWorker(text: string, from: string, to: string): Promise<string> {
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    // The worker is left running: a model download it is in the middle of is
    // only stored once it completes, so killing it would restart that download
    // on every retry. A late reply finds no pending call and is dropped.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Translation timed out"));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    activeWorker().postMessage({ type: "translate", id, text, from, to });
  });
}
