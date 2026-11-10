import type { TranslationTargetLanguage } from "@/i18n";

import { openDatabase, requestResult, transactionDone } from "./idb";

interface StoredTranslation {
  key: string;
  translation: string;
  targetLanguage: TranslationTargetLanguage;
  /** Time of the last write; it is what the oldest-first trimming goes by. */
  accessedAt: number;
}

const DB_NAME = "stellarr-chat-translations";
const DB_VERSION = 1;
const STORE = "translations";
const BY_ACCESS = "accessedAt";

const MEMORY_LIMIT = 1_000;
const STORED_LIMIT = 5_000;
const TRIM_EVERY_WRITES = 50;

// Insertion order decides what is evicted: a write, or a load from the stored
// copy, moves a key to the end, while a hit in memory leaves it where it is.
const memory = new Map<string, string>();
let writesSinceTrim = 0;

/** Length plus two independent 32-bit hashes keeps keys short without long collision runs. */
function contentHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${value.length}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function cacheKey(content: string, targetLanguage: TranslationTargetLanguage): string {
  return `${targetLanguage}:${contentHash(content)}`;
}

const openCache = () =>
  openDatabase(DB_NAME, DB_VERSION, (database) => {
    database
      .createObjectStore(STORE, { keyPath: "key" })
      .createIndex(BY_ACCESS, BY_ACCESS);
  });

function remember(key: string, translation: string): void {
  memory.delete(key);
  memory.set(key, translation);
  for (const oldest of memory.keys()) {
    if (memory.size <= MEMORY_LIMIT) break;
    memory.delete(oldest);
  }
}

/** Memory only, so a render can use it without waiting. */
export function getSync(key: string): string | undefined {
  return memory.get(key);
}

export async function get(key: string): Promise<string | undefined> {
  const quick = getSync(key);
  if (quick !== undefined || typeof indexedDB === "undefined") return quick;

  try {
    const database = await openCache();
    try {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
      const row = (await requestResult(request)) as StoredTranslation | undefined;
      if (row === undefined) return undefined;
      remember(key, row.translation);
      return row.translation;
    } finally {
      database.close();
    }
  } catch {
    return undefined;
  }
}

async function trimStored(database: IDBDatabase): Promise<void> {
  const total = await requestResult(
    database.transaction(STORE, "readonly").objectStore(STORE).count(),
  );
  let excess = total - STORED_LIMIT;
  if (excess <= 0) return;

  const transaction = database.transaction(STORE, "readwrite");
  const cursorRequest = transaction.objectStore(STORE).index(BY_ACCESS).openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor === null || excess === 0) return;
    cursor.delete();
    excess -= 1;
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function set(
  key: string,
  translation: string,
  targetLanguage: TranslationTargetLanguage,
): Promise<void> {
  remember(key, translation);
  if (typeof indexedDB === "undefined") return;

  try {
    const database = await openCache();
    try {
      const transaction = database.transaction(STORE, "readwrite");
      const row: StoredTranslation = { key, translation, targetLanguage, accessedAt: Date.now() };
      transaction.objectStore(STORE).put(row);
      await transactionDone(transaction);

      writesSinceTrim += 1;
      if (writesSinceTrim >= TRIM_EVERY_WRITES) {
        writesSinceTrim = 0;
        await trimStored(database);
      }
    } finally {
      database.close();
    }
  } catch {
    // The stored copy is an optimisation; the memory copy is already in place.
  }
}
