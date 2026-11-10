import { useEffect, useMemo, useRef } from "react";

import { playSystemFx } from "@/lib/audio/systemFx";
import type { VoiceState } from "@/lib/voice/types";
import type { Ports } from "@/ports";

interface FxSnapshot {
  connection: VoiceState["connection"];
  channelId: VoiceState["channelId"];
  peerIds: ReadonlySet<string>;
  shareOwnerId: string | null;
}

interface VoiceFxInput {
  soundboard: Pick<Ports["soundboard"], "takeJoinAnnouncement">;
  state: VoiceState;
  userId: string | null;
  shareOwnerId: string | null;
  /** The "join and leave sounds" preference. */
  arrivals: boolean;
}

/**
 * Plays the system sounds for what the RTC layer confirms: this user joining
 * or leaving, other people coming and going, and a screen share starting or
 * stopping. Following confirmed state, not clicks, covers remote events too and
 * never announces a join that later fails.
 *
 * An arrival somebody chose a clip for is announced by that clip instead of the
 * shared chime, since two greetings for one door is one too many. The hub sends
 * the clip as the person joins, so by the time the media layer confirms the
 * arrival the soundboard already knows whose it was.
 *
 * Someone who turned arrivals off hears neither, their own included. A share
 * has sounds of its own, which that preference does not touch.
 */
export function useVoiceFx({ soundboard, state, userId, shareOwnerId, arrivals }: VoiceFxInput) {
  const { connection, channelId } = state;

  // Speaking levels replace `state.peers` many times a second; keying on the
  // ids keeps the effect asleep until membership actually changes.
  const peerIdsKey = state.peers
    .map((peer) => peer.userId)
    .sort()
    .join("\u0000");
  const peerIds = useMemo<ReadonlySet<string>>(
    () => new Set(peerIdsKey === "" ? [] : peerIdsKey.split("\u0000")),
    [peerIdsKey],
  );

  const previous = useRef<FxSnapshot>({ connection, channelId, peerIds, shareOwnerId });

  useEffect(() => {
    const before = previous.current;
    previous.current = { connection, channelId, peerIds, shareOwnerId };

    // Asking consumes the answer, so each arrival is asked about exactly once.
    const hadOwnClip = (id: string | null): boolean =>
      id !== null && soundboard.takeJoinAnnouncement(id);

    const joined = connection === "connected" && before.connection !== "connected";
    const left = before.channelId !== null && channelId === null;
    if (joined && arrivals && !hadOwnClip(userId)) playSystemFx("join");
    if (left && arrivals) playSystemFx("leave");

    if (
      before.connection === "connected" &&
      connection === "connected" &&
      before.channelId === channelId
    ) {
      // Two people walking in together, one with a clip of their own, still
      // owe the other a chime.
      const arrived = [...peerIds].filter((id) => !before.peerIds.has(id));
      const unannounced = arrived.filter((id) => !hadOwnClip(id));
      const departed = [...before.peerIds].some((id) => !peerIds.has(id));
      if (unannounced.length > 0 && arrivals) playSystemFx("join");
      if (departed && arrivals) playSystemFx("leave");
    }

    if (before.shareOwnerId !== shareOwnerId) {
      if (shareOwnerId !== null) playSystemFx("stream");
      else if (!left && channelId !== null) playSystemFx("leave");
    }
  }, [soundboard, arrivals, connection, channelId, peerIds, shareOwnerId, userId]);
}
