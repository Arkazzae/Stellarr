import type { TranslationTargetLanguage } from "@/i18n";

import { detectLanguage } from "./detectLanguage";
import * as cache from "./translationCache";
import { runInWorker } from "./translationWorker";

interface Job {
  text: string;
  targetLanguage: TranslationTargetLanguage;
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
}

export class TranslationCancelledError extends Error {
  constructor() {
    super("Translation cancelled");
  }
}

export interface TranslateOptions {
  /** Jump ahead of work that is already waiting, for messages the reader is looking at. */
  priority?: boolean;
}

const waiting: Job[] = [];
const sharedRequests = new Map<string, Promise<string>>();
let draining = false;

/** When a message could not be identified, assume the other chat language. */
function assumedSource(targetLanguage: TranslationTargetLanguage): TranslationTargetLanguage {
  return targetLanguage === "en" ? "pl" : "en";
}

async function run({ text, targetLanguage }: Job): Promise<string> {
  const detected = await detectLanguage(text);
  if (detected === targetLanguage) return text;
  return runInWorker(
    text,
    detected === "und" ? assumedSource(targetLanguage) : detected,
    targetLanguage,
  );
}

/** The worker handles one message at a time, so jobs are run strictly in turn. */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (let job = waiting.shift(); job !== undefined; job = waiting.shift()) {
      try {
        job.resolve(await run(job));
      } catch (error) {
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  } finally {
    draining = false;
  }
}

function schedule(
  text: string,
  targetLanguage: TranslationTargetLanguage,
  priority: boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const job: Job = { text, targetLanguage, resolve, reject };
    if (priority) waiting.unshift(job);
    else waiting.push(job);
    void drain();
  });
}

async function translateUncached(
  key: string,
  text: string,
  targetLanguage: TranslationTargetLanguage,
  priority: boolean,
): Promise<string> {
  const stored = await cache.get(key);
  if (stored !== undefined) return stored;

  const translation = await schedule(text, targetLanguage, priority);
  await cache.set(key, translation, targetLanguage);
  return translation;
}

/**
 * Translates on the device, in a worker. Identical concurrent requests share
 * one job and finished translations are cached in memory and IndexedDB.
 * A failure rejects and is not cached, so asking again tries again.
 */
export function translate(
  text: string,
  targetLanguage: TranslationTargetLanguage,
  options: TranslateOptions = {},
): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return Promise.resolve(text);

  const key = cache.cacheKey(trimmed, targetLanguage);
  const known = cache.getSync(key);
  if (known !== undefined) return Promise.resolve(known);

  const shared = sharedRequests.get(key);
  if (shared !== undefined) return shared;

  const request = translateUncached(
    key,
    trimmed,
    targetLanguage,
    options.priority === true,
  ).finally(() => sharedRequests.delete(key));
  sharedRequests.set(key, request);
  return request;
}

/** Drops jobs that have not started, for when the reader moves to another room. */
export function cancelPending(): void {
  for (const job of waiting.splice(0)) job.reject(new TranslationCancelledError());
}
