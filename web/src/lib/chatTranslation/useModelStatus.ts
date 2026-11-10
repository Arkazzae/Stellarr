"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TranslationTargetLanguage } from "@/i18n";

import { downloadModel, getModelStatus, getPairSize } from "./modelStatus";

export type ModelDownloadState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "not-downloaded"; sizeMb: number }
  | { status: "unavailable" }
  | { status: "downloading"; progress: number }
  | { status: "error"; message: string };

const BYTES_PER_MB = 1024 * 1024;
const CHECKING: ModelDownloadState = { status: "checking" };

function failure(error: unknown, fallback: string): ModelDownloadState {
  return { status: "error", message: error instanceof Error ? error.message : fallback };
}

/**
 * Tracks whether the translation model for `targetLanguage` is on the device.
 * While `enabled` is false nothing is checked and the state is `checking`.
 */
export function useModelStatus(targetLanguage: TranslationTargetLanguage, enabled: boolean) {
  const [state, setState] = useState<ModelDownloadState>(CHECKING);
  // Each check or download takes a ticket; only the latest one may write state,
  // so a slow answer for a previous language or an unmounted pane is dropped.
  const latest = useRef(0);

  const settle = useCallback((ticket: number, next: ModelDownloadState) => {
    if (latest.current === ticket) setState(next);
  }, []);

  const lookUp = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const status = await getModelStatus(targetLanguage);
      if (status !== "not-downloaded") {
        settle(ticket, { status });
        return;
      }
      const size = await getPairSize(targetLanguage);
      settle(ticket, { status, sizeMb: Math.ceil(size / BYTES_PER_MB) });
    } catch (error) {
      settle(ticket, failure(error, "Model check failed"));
    }
  }, [settle, targetLanguage]);

  const check = useCallback(async () => {
    setState(CHECKING);
    if (enabled) await lookUp();
  }, [enabled, lookUp]);

  const download = useCallback(async () => {
    const ticket = ++latest.current;
    setState({ status: "downloading", progress: 0 });
    try {
      await downloadModel(targetLanguage, (progress) =>
        settle(ticket, { status: "downloading", progress }),
      );
      settle(ticket, { status: "ready" });
    } catch (error) {
      settle(ticket, failure(error, "Model download failed"));
    }
  }, [settle, targetLanguage]);

  useEffect(() => {
    if (!enabled) return;
    void lookUp();
    return () => {
      latest.current += 1;
      setState(CHECKING);
    };
  }, [enabled, lookUp]);

  return { state, check, download };
}
