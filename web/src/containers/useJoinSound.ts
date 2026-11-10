"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { JoinSoundLibrary, JoinSoundServerGroup } from "@/lib/api/types";
import type { JoinSoundPicker } from "@/ports";
import { useAccount, usePorts } from "@/state/hooks";

/** The server's own ceiling, used until the catalogue says what it is. */
const FALLBACK_MAX_SECONDS = 5;

const NO_SERVERS: readonly JoinSoundServerGroup[] = [];

type Phase = "loading" | "ready" | "failed";

/**
 * The arrival-sound picker.
 *
 * The catalogue spans every server the person belongs to and changes whenever
 * one of those soundboards does, so it is fetched while the settings dialog is
 * open and read by exactly one pane. The choice itself is a preference like
 * any other and lives on the account.
 */
export function useJoinSound(open: boolean): JoinSoundPicker {
  const { account: accountPort, soundboard } = usePorts();
  const account = useAccount();
  const [library, setLibrary] = useState<JoinSoundLibrary | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);

  // Opening the dialog again refetches without blanking the list: the
  // catalogue rarely changes between two visits, and a spinner over a list
  // that is about to come back identical is a flash of nothing.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    accountPort.listJoinSounds(controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setLibrary(loaded);
        setPhase("ready");
      },
      () => {
        if (!controller.signal.aborted) setPhase("failed");
      },
    );
    return () => controller.abort();
  }, [accountPort, attempt, open]);

  const reload = useCallback(() => {
    setPhase("loading");
    setAttempt((count) => count + 1);
  }, []);

  const servers = library?.servers ?? NO_SERVERS;
  const selectedId = account.preferences.joinSoundId;
  const selected = useMemo(
    () =>
      selectedId === null
        ? undefined
        : servers.flatMap((group) => group.sounds).find((sound) => sound.id === selectedId),
    [selectedId, servers],
  );

  const select = useCallback(
    (soundId: string | null) => {
      void account.setPreferences({ joinSoundId: soundId }).catch(() => undefined);
    },
    [account],
  );

  const preview = useCallback(() => {
    if (selected === undefined) return;
    // Called inside the click, so the browser's autoplay policy counts it as
    // the person asking to hear it. The clip already arrives cut to the window.
    void soundboard.preview(selected).catch(() => undefined);
  }, [soundboard, selected]);

  return {
    servers,
    loading: phase === "loading",
    failed: phase === "failed",
    selectedId,
    selectionAvailable: selectedId === null || selected !== undefined,
    maxSeconds:
      library !== null && library.maxSeconds > 0
        ? library.maxSeconds
        : FALLBACK_MAX_SECONDS,
    select,
    preview,
    reload,
  };
}
