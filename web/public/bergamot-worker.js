/**
 * Bergamot translation Web Worker.
 * Loads bergamot-translator WASM, downloads language models on-demand
 * from the Bergamot model registry, caches them in IndexedDB.
 *
 * Protocol:
 *   Main → Worker: { type: "translate", id, text, from, to }
 *   Worker → Main: { type: "result", id, translation }
 *   Worker → Main: { type: "error", id, message }
 */

const MODEL_REGISTRY_URL = "/bergamot-models";
const MODEL_GCS_URL = "/bergamot-models-gcs";

const BERGAMOT_WASM_BASE = "/codecs/bergamot";

const MODEL_CONFIG = `beam-size: 1
normalize: 1.0
word-penalty: 0
max-length-break: 128
mini-batch-words: 1024
workspace: 128
max-length-factor: 2.0
skip-cost: true
cpu-threads: 0
quiet: true
quiet-translation: true
gemm-precision: int8shiftAlphaAll
alignment: soft
`;

// ── IndexedDB helpers ──

const DB_NAME = "bergamot-models";
const DB_STORE = "files";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Model registry ──

let registryCache = null;

async function fetchRegistry() {
  if (registryCache) return registryCache;
  const resp = await fetch(`${MODEL_REGISTRY_URL}/registry.json`);
  if (!resp.ok) throw new Error(`Failed to fetch model registry: ${resp.status}`);
  registryCache = await resp.json();
  return registryCache;
}

/**
 * Look up model files for a language pair from the registry.
 * Returns { model, lex, vocab } file names, or null if pair not found.
 */
async function getModelFiles(langPair) {
  const registry = await fetchRegistry();
  // Registry keys are like "enfr", "deen", etc.
  const entry = registry[langPair];
  if (!entry) return null;
  return {
    model: entry.model?.name,
    lex: entry.lex?.name,
    vocab: entry.vocab?.name,
  };
}

// ── Bergamot WASM loading ──

let moduleReady = null;

function loadBergamotModule() {
  if (moduleReady) return moduleReady;
  moduleReady = new Promise((resolve, reject) => {
    self.Module = {
      locateFile(path) {
        return `${BERGAMOT_WASM_BASE}/${path}`;
      },
      onRuntimeInitialized() {
        resolve(self.Module);
      },
    };
    try {
      importScripts(`${BERGAMOT_WASM_BASE}/bergamot-translator-worker.js`);
    } catch (e) {
      moduleReady = null;
      reject(new Error(`Failed to load Bergamot WASM: ${e.message}`));
    }
  });
  return moduleReady;
}

// ── Model management ──

async function fetchModelFile(langPair, fileName) {
  const cacheKey = `${langPair}/${fileName}`;
  const cached = await idbGet(cacheKey);
  if (cached) return cached;

  // Try local models first, fall back to GCS proxy
  const localUrl = `${MODEL_REGISTRY_URL}/${langPair}/${fileName}`;
  let response = await fetch(localUrl);
  if (!response.ok) {
    const gcsUrl = `${MODEL_GCS_URL}/${langPair}/${fileName}`;
    response = await fetch(gcsUrl);
  }
  if (!response.ok) throw new Error(`Failed to download model ${langPair}/${fileName}`);
  const buffer = await response.arrayBuffer();
  await idbSet(cacheKey, buffer);
  return buffer;
}

function loadAlignedMemory(buffer, alignment) {
  const bytes = new Int8Array(buffer);
  const memory = new self.Module.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(bytes);
  return memory;
}

const loadedModels = new Map();

async function getModel(langPair) {
  if (loadedModels.has(langPair)) return loadedModels.get(langPair);

  const files = await getModelFiles(langPair);
  if (!files || !files.model || !files.lex || !files.vocab) {
    throw new Error(`No model available for language pair: ${langPair}`);
  }

  const [modelBuf, lexBuf, vocabBuf] = await Promise.all([
    fetchModelFile(langPair, files.model),
    fetchModelFile(langPair, files.lex),
    fetchModelFile(langPair, files.vocab),
  ]);

  const modelMem = loadAlignedMemory(modelBuf, 256);
  const shortlistMem = loadAlignedMemory(lexBuf, 64);
  const vocabMem = loadAlignedMemory(vocabBuf, 64);
  const vocabList = new self.Module.AlignedMemoryList();
  vocabList.push_back(vocabMem);

  const model = new self.Module.TranslationModel(
    MODEL_CONFIG, modelMem, shortlistMem, vocabList, null
  );
  loadedModels.set(langPair, model);
  return model;
}

// ── Translation ──

let service = null;

function getService() {
  if (!service) {
    service = new self.Module.BlockingService({ cacheSize: 20000 });
  }
  return service;
}

function translateDirect(model, text) {
  const svc = getService();
  const input = new self.Module.VectorString();
  const options = new self.Module.VectorResponseOptions();

  input.push_back(text);
  options.push_back({ qualityScores: false, alignment: false, html: false });

  const output = svc.translate(model, input, options);
  const result = output.get(0).getTranslatedText();

  input.delete();
  options.delete();
  output.delete();

  return result;
}

function translateViaPivot(firstModel, secondModel, text) {
  const svc = getService();
  const input = new self.Module.VectorString();
  const options = new self.Module.VectorResponseOptions();

  input.push_back(text);
  options.push_back({ qualityScores: false, alignment: false, html: false });

  const output = svc.translateViaPivoting(firstModel, secondModel, input, options);
  const result = output.get(0).getTranslatedText();

  input.delete();
  options.delete();
  output.delete();

  return result;
}

async function handleTranslate(from, to, text) {
  await loadBergamotModule();

  const directPair = `${from}${to}`;
  const registry = await fetchRegistry();

  // Direct model exists
  if (registry[directPair]) {
    const model = await getModel(directPair);
    return translateDirect(model, text);
  }

  // Pivot through English
  const srcToEn = `${from}en`;
  const enToTgt = `en${to}`;

  if (to === "en" && registry[srcToEn]) {
    const model = await getModel(srcToEn);
    return translateDirect(model, text);
  }

  if (from === "en" && registry[enToTgt]) {
    const model = await getModel(enToTgt);
    return translateDirect(model, text);
  }

  if (registry[srcToEn] && registry[enToTgt]) {
    const m1 = await getModel(srcToEn);
    const m2 = await getModel(enToTgt);
    return translateViaPivot(m1, m2, text);
  }

  throw new Error(`No translation model available for ${from} → ${to}`);
}

// ── Message handler ──

self.onmessage = async function (e) {
  const { type, id, text, from, to } = e.data;
  if (type !== "translate") return;

  try {
    const translation = await handleTranslate(from || "en", to || "en", text);
    self.postMessage({ type: "result", id, translation });
  } catch (err) {
    self.postMessage({ type: "error", id, message: err.message || String(err) });
  }
};
