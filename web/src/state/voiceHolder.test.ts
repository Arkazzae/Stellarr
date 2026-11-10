import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_VOICE_STATE } from "@/lib/voice/types";
import { FakeVoiceClient } from "@/test/fakes";

import { VoiceHolder } from "./voiceHolder";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("VoiceHolder", () => {
  it("is idle with no client and no start time", () => {
    const holder = new VoiceHolder();

    expect(holder.getClient()).toBeNull();
    expect(holder.getState()).toBe(IDLE_VOICE_STATE);
    expect(holder.getStartedAt()).toBeNull();
  });

  it("republishes the client's snapshot to subscribers", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    const listener = vi.fn();
    holder.attach(client);
    holder.subscribe(listener);

    client.set({ muted: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(holder.getState().muted).toBe(true);
  });

  it("starts the clock when the client reports a channel, not before", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    holder.attach(client);
    expect(holder.getStartedAt()).toBeNull();

    client.set({ channelId: "voice", connection: "connecting" });
    const startedAt = holder.getStartedAt();
    expect(startedAt).toBe(Date.now());

    vi.advanceTimersByTime(60_000);
    client.set({ connection: "connected" });
    expect(holder.getStartedAt()).toBe(startedAt);
  });

  it("clears the clock when the channel is left", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    holder.attach(client);
    client.set({ channelId: "voice", connection: "connected" });

    client.set({ channelId: null, connection: "idle" });

    expect(holder.getStartedAt()).toBeNull();
  });

  it("restarts the clock when the client moves to another channel", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    holder.attach(client);
    client.set({ channelId: "one", connection: "connected" });

    vi.advanceTimersByTime(5_000);
    client.set({ channelId: "two" });

    expect(holder.getStartedAt()).toBe(Date.now());
  });

  it("disposes the client on detach and returns to idle", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    holder.attach(client);
    client.set({ channelId: "voice", connection: "connected" });

    holder.detach();

    expect(client.dispose).toHaveBeenCalledOnce();
    expect(holder.getClient()).toBeNull();
    expect(holder.getState()).toBe(IDLE_VOICE_STATE);
    expect(holder.getStartedAt()).toBeNull();
  });

  it("stops following a client once it is detached", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    holder.attach(client);
    holder.detach();
    const listener = vi.fn();
    holder.subscribe(listener);

    client.set({ muted: true });

    expect(listener).not.toHaveBeenCalled();
    expect(holder.getState()).toBe(IDLE_VOICE_STATE);
  });

  it("disposes the previous client when a new one is attached", () => {
    const holder = new VoiceHolder();
    const first = new FakeVoiceClient();
    const second = new FakeVoiceClient();
    holder.attach(first);

    holder.attach(second);

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(holder.getClient()).toBe(second);
  });

  it("stops notifying a listener that unsubscribed", () => {
    const holder = new VoiceHolder();
    const client = new FakeVoiceClient();
    holder.attach(client);
    const listener = vi.fn();
    const unsubscribe = holder.subscribe(listener);
    unsubscribe();

    client.set({ muted: true });

    expect(listener).not.toHaveBeenCalled();
  });
});
