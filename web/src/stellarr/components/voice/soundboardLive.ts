import type { SoundboardLive, SoundboardPlay } from "@/ports";

const NOTHING_PLAYS: readonly SoundboardPlay[] = [];

/** A store in which nothing ever plays, for a panel shown without a board behind it. */
export const IDLE_SOUNDBOARD: SoundboardLive = {
  subscribe: () => () => undefined,
  playing: () => NOTHING_PLAYS,
  cooldownSeconds: () => 0,
};
