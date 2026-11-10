import { describe, expect, it } from "vitest";

import type { PersonVM } from "@/components/view-models";
import { IDLE_VOICE_STATE, type VoicePeer, type VoiceState } from "@/lib/voice/types";

import {
  callHeadline,
  deriveVoiceView,
  shareSourceOf,
  type VoiceViewInput,
} from "./voiceView";

function stateWith(patch: Partial<VoiceState>): VoiceState {
  return { ...IDLE_VOICE_STATE, ...patch };
}

function peer(userId: string, patch: Partial<VoicePeer> = {}): VoicePeer {
  return {
    userId,
    displayName: userId.toUpperCase(),
    muted: false,
    speaking: false,
    level: 0,
    playbackVolume: 100,
    gated: false,
    suppressed: false,
    self: false,
    screen: null,
    camera: null,
    ...patch,
  };
}

function person(id: string): PersonVM {
  return { id, displayName: id, initials: id.slice(0, 2), presence: "online" };
}

function inputFor(state: VoiceState, patch: Partial<VoiceViewInput> = {}): VoiceViewInput {
  return {
    state,
    userId: "me",
    displayName: "Me",
    startedAt: 1_000,
    deafened: false,
    room: null,
    roomName: state.channelId,
    watching: false,
    occupantsOf: () => [],
    source: shareSourceOf(state, "me"),
    ...patch,
  };
}

const transport = IDLE_VOICE_STATE.transport;

describe("callHeadline", () => {
  it("shows the screen over a healthy connection", () => {
    const state = stateWith({
      connection: "connected",
      localScreen: { streamId: "s", hasAudio: false, stream: null },
    });

    expect(callHeadline(state)).toBe("screen");
  });

  it("lets a failed connection outrank a share that is still live", () => {
    const state = stateWith({
      connection: "failed",
      localScreen: { streamId: "s", hasAudio: false, stream: null },
    });

    expect(callHeadline(state)).toBe("failed");
  });

  it("reports failed media before a reconnecting signal", () => {
    const state = stateWith({
      connection: "connected",
      transport: { ...transport, media: "failed", signaling: "reconnecting" },
    });

    expect(callHeadline(state)).toBe("failed");
  });

  it.each(["reconnecting", "disconnected"] as const)(
    "reports a %s signalling channel as reconnecting",
    (signaling) => {
      const state = stateWith({
        connection: "connected",
        transport: { ...transport, signaling },
      });

      expect(callHeadline(state)).toBe("reconnecting");
    },
  );

  it("reports degraded media on an otherwise connected call", () => {
    const state = stateWith({
      connection: "connected",
      transport: { ...transport, media: "degraded" },
    });

    expect(callHeadline(state)).toBe("degraded");
  });

  it("waits on the microphone before anything else", () => {
    expect(callHeadline(stateWith({ connection: "requesting-mic" }))).toBe("requesting-mic");
  });

  it("is connecting while media negotiates", () => {
    const state = stateWith({
      connection: "connected",
      transport: { ...transport, media: "connecting" },
    });

    expect(callHeadline(state)).toBe("connecting");
  });
});

describe("shareSourceOf", () => {
  it("has no source when nobody shares", () => {
    const state = stateWith({ peers: [peer("ada")] });

    expect(shareSourceOf(state, "me")).toEqual({ key: null, ownerId: null, remote: null });
  });

  it("prefers the local share over a remote one", () => {
    const state = stateWith({
      localScreen: { streamId: "mine", hasAudio: false, stream: null },
      peers: [peer("ada", { screen: { streamId: "theirs", hasAudio: false, stream: null } })],
    });

    expect(shareSourceOf(state, "me")).toEqual({
      key: "local:me:mine",
      ownerId: "me",
      remote: null,
    });
  });

  it("names the remote stream, so a new stream is a different source", () => {
    const withStream = (streamId: string) =>
      shareSourceOf(
        stateWith({
          peers: [peer("ada", { screen: { streamId, hasAudio: false, stream: null } })],
        }),
        "me",
      );

    expect(withStream("one").key).toBe("remote:ada:one");
    expect(withStream("two").key).not.toBe(withStream("one").key);
    expect(withStream("one").ownerId).toBe("ada");
  });

  it("still names the local share before the user is known", () => {
    const state = stateWith({
      localScreen: { streamId: "mine", hasAudio: false, stream: null },
    });

    expect(shareSourceOf(state, null).ownerId).toBe("self");
  });
});

describe("deriveVoiceView", () => {
  describe("call", () => {
    it("is absent while the client is idle", () => {
      const view = deriveVoiceView(inputFor(stateWith({ channelId: "voice" })));

      expect(view.call).toBeNull();
    });

    it("is absent without a channel", () => {
      const view = deriveVoiceView(inputFor(stateWith({ connection: "connected" })));

      expect(view.call).toBeNull();
    });

    it("carries the room name, mute, deafen and rounded latency", () => {
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        muted: true,
        diagnostics: { ...IDLE_VOICE_STATE.diagnostics, rttMs: 41.6, quality: "good" },
      });

      const { call } = deriveVoiceView(
        inputFor(state, { roomName: "Lounge", deafened: true, startedAt: 7 }),
      );

      expect(call).toMatchObject({
        channelId: "voice",
        channelName: "Lounge",
        startedAt: 7,
        muted: true,
        deafened: true,
        latencyMs: 42,
        connectionQuality: "good",
        headline: "connected",
      });
      expect(call).not.toHaveProperty("privateCall");
    });

    it("reports no latency before the first sample", () => {
      const state = stateWith({ channelId: "voice", connection: "connected" });

      expect(deriveVoiceView(inputFor(state)).call?.latencyMs).toBeNull();
    });

    it("marks a private call", () => {
      const state = stateWith({ channelId: "dm", connection: "connected" });

      const view = deriveVoiceView(
        inputFor(state, { room: { label: "Ada", privateCall: true } }),
      );

      expect(view.privateCall).toBe(true);
      expect(view.call?.privateCall).toBe(true);
    });
  });

  describe("people", () => {
    it("is empty outside a call", () => {
      const view = deriveVoiceView(inputFor(stateWith({}), { occupantsOf: () => [person("ada")] }));

      expect(view.people).toEqual([]);
    });

    it("lists the directory's occupants with live speech applied", () => {
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        peers: [peer("ada", { speaking: true, muted: true })],
      });

      const view = deriveVoiceView(inputFor(state, { occupantsOf: () => [person("ada")] }));

      expect(view.people).toEqual([{ ...person("ada"), speaking: true, muted: true }]);
    });

    it("adds a negotiated peer the directory has not caught up with", () => {
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        peers: [peer("ada"), peer("bartek", { displayName: "Bartek Nowak", speaking: true })],
      });

      const view = deriveVoiceView(inputFor(state, { occupantsOf: () => [person("ada")] }));

      expect(view.people.map((p) => p.id)).toEqual(["ada", "bartek"]);
      expect(view.people[1]).toMatchObject({
        displayName: "Bartek Nowak",
        initials: "BN",
        presence: "online",
        speaking: true,
      });
    });

    it("prefers the caller's own list over the directory's", () => {
      const state = stateWith({ channelId: "dm", connection: "connecting" });

      const view = deriveVoiceView(
        inputFor(state, {
          room: { label: "Ada", people: [person("ada")] },
          occupantsOf: () => [person("someone-else")],
        }),
      );

      expect(view.people.map((p) => p.id)).toEqual(["ada"]);
    });
  });

  describe("share", () => {
    const remoteScreen = { streamId: "s", hasAudio: true, stream: {} as MediaStream };

    function remoteShare(watching: boolean) {
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        peers: [peer("ada", { screen: remoteScreen })],
      });
      return deriveVoiceView(inputFor(state, { watching })).share;
    }

    it("withholds a remote stream until the viewer opts in", () => {
      expect(remoteShare(false)).toEqual({
        ownerId: "ada",
        ownerName: "ADA",
        hasAudio: true,
        stream: null,
        watching: false,
      });
    });

    it("hands the remote stream over once the viewer opts in", () => {
      expect(remoteShare(true)).toMatchObject({ stream: remoteScreen.stream, watching: true });
    });

    it("previews the user's own capture as already watched", () => {
      const stream = {} as MediaStream;
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        localScreen: { streamId: "mine", hasAudio: false, stream },
      });

      const view = deriveVoiceView(inputFor(state));

      expect(view.share).toEqual({
        ownerId: "me",
        ownerName: "Me",
        hasAudio: false,
        stream,
        watching: true,
      });
    });

    it("is absent when nobody shares", () => {
      const state = stateWith({ channelId: "voice", connection: "connected", peers: [peer("ada")] });

      expect(deriveVoiceView(inputFor(state)).share).toBeNull();
    });
  });

  describe("per-participant settings", () => {
    it("leaves the user's own strip out", () => {
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        peers: [
          peer("me", { self: true, playbackVolume: 100 }),
          peer("ada", { playbackVolume: 150, gated: true, suppressed: true }),
        ],
      });

      const view = deriveVoiceView(inputFor(state));

      expect([...view.participantVolumes]).toEqual([["ada", 150]]);
      expect([...view.participantGates]).toEqual([["ada", true]]);
      expect([...view.participantSuppressions]).toEqual([["ada", true]]);
    });
  });

  describe("camera streams", () => {
    it("collects remote cameras and the user's own preview by id", () => {
      const remote = {} as MediaStream;
      const local = {} as MediaStream;
      const state = stateWith({
        channelId: "voice",
        connection: "connected",
        peers: [peer("ada", { camera: { streamId: "c", stream: remote } })],
        localCamera: { streamId: "mine", stream: local },
      });

      const view = deriveVoiceView(inputFor(state));

      expect(view.cameraStreams.get("ada")).toBe(remote);
      expect(view.cameraStreams.get("me")).toBe(local);
    });

    it("shares one empty map while no camera is on", () => {
      const first = deriveVoiceView(inputFor(stateWith({}))).cameraStreams;
      const second = deriveVoiceView(inputFor(stateWith({ channelId: "x" }))).cameraStreams;

      expect(first.size).toBe(0);
      expect(second).toBe(first);
    });
  });
});
