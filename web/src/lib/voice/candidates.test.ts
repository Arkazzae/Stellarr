import { describe, expect, it, vi } from "vitest";
import {
  RemoteCandidateQueue,
  isEndOfCandidates,
  normalise,
  type CandidateTarget,
} from "./candidates";

function candidate(foundation: string): RTCIceCandidateInit {
  return {
    candidate: `candidate:${foundation} 1 udp 2122260223 192.168.1.5 55000 typ host`,
    sdpMid: "0",
    sdpMLineIndex: 0,
  };
}

/** A peer connection stand-in that records the order candidates arrive in. */
function fakeTarget(options: { remote?: boolean } = {}) {
  const applied: string[] = [];
  let remote = options.remote ?? false;
  const target: CandidateTarget & {
    applied: string[];
    setRemote(value: boolean): void;
    addIceCandidate: ReturnType<typeof vi.fn>;
  } = {
    applied,
    setRemote(value: boolean) {
      remote = value;
    },
    hasRemoteDescription: () => remote,
    addIceCandidate: vi.fn(async (init: RTCIceCandidateInit | null) => {
      applied.push(init?.candidate ?? "<null>");
    }),
  };
  return target;
}

describe("RemoteCandidateQueue", () => {
  it("applies immediately once a remote description exists", async () => {
    const target = fakeTarget({ remote: true });
    const queue = new RemoteCandidateQueue(target);

    await queue.add(candidate("a"));

    expect(target.addIceCandidate).toHaveBeenCalledTimes(1);
    expect(queue.size).toBe(0);
  });

  it("holds candidates that arrive before the description", async () => {
    const target = fakeTarget({ remote: false });
    const queue = new RemoteCandidateQueue(target);

    await queue.add(candidate("a"));
    await queue.add(candidate("b"));

    expect(target.addIceCandidate).not.toHaveBeenCalled();
    expect(queue.size).toBe(2);
  });

  it("flushes early candidates in arrival order", async () => {
    const target = fakeTarget({ remote: false });
    const queue = new RemoteCandidateQueue(target);

    await queue.add(candidate("a"));
    await queue.add(candidate("b"));
    await queue.add(candidate("c"));

    target.setRemote(true);
    await queue.flush();

    // Order matters: candidates are sent in priority order, and replaying them
    // out of order makes ICE try worse pairs first.
    expect(target.applied.map((line) => line.split(" ")[0])).toEqual([
      "candidate:a",
      "candidate:b",
      "candidate:c",
    ]);
    expect(queue.size).toBe(0);
  });

  it("keeps order when adds race the description being set", async () => {
    const target = fakeTarget({ remote: false });
    const queue = new RemoteCandidateQueue(target);

    // Fire without awaiting, the way the signalling handler actually does.
    const first = queue.add(candidate("a"));
    const second = queue.add(candidate("b"));
    target.setRemote(true);
    const third = queue.add(candidate("c"));
    await Promise.all([first, second, third, queue.flush()]);

    expect(target.applied.map((line) => line.split(" ")[0])).toEqual([
      "candidate:a",
      "candidate:b",
      "candidate:c",
    ]);
  });

  it("preserves the end-of-candidates marker in sequence", async () => {
    const target = fakeTarget({ remote: false });
    const queue = new RemoteCandidateQueue(target);

    await queue.add(candidate("a"));
    await queue.add(null);
    target.setRemote(true);
    await queue.flush();

    expect(target.applied).toHaveLength(2);
    // Sent as the empty-string form, which every stack understands.
    expect(target.addIceCandidate.mock.calls[1]?.[0]).toEqual({
      candidate: "",
      sdpMid: "",
      sdpMLineIndex: 0,
    });
  });

  it("does not let one rejected candidate block the ones behind it", async () => {
    const target = fakeTarget({ remote: true });
    const errors: unknown[] = [];
    target.addIceCandidate.mockImplementationOnce(async () => {
      throw new Error("candidate from an ignored offer");
    });
    const queue = new RemoteCandidateQueue(target, (error) => errors.push(error));

    await queue.add(candidate("a"));
    await queue.add(candidate("b"));

    expect(errors).toHaveLength(1);
    expect(target.addIceCandidate).toHaveBeenCalledTimes(2);
  });

  it("never rejects, so a failed candidate cannot break the signalling handler", async () => {
    const target = fakeTarget({ remote: true });
    target.addIceCandidate.mockRejectedValue(new Error("nope"));
    const queue = new RemoteCandidateQueue(target);

    await expect(queue.add(candidate("a"))).resolves.toBeUndefined();
  });

  it("retains what is left when the description is rolled back mid-drain", async () => {
    const target = fakeTarget({ remote: true });
    const queue = new RemoteCandidateQueue(target);
    // Applying the first candidate triggers a rollback, as a glare would.
    target.addIceCandidate.mockImplementationOnce(async () => {
      target.applied.push("a");
      target.setRemote(false);
    });

    await queue.add(candidate("a"));
    await queue.add(candidate("b"));

    expect(queue.size).toBe(1);
    target.setRemote(true);
    await queue.flush();
    expect(target.applied).toHaveLength(2);
  });

  it("drops the backlog on clear but stays usable", async () => {
    const target = fakeTarget({ remote: false });
    const queue = new RemoteCandidateQueue(target);
    await queue.add(candidate("a"));

    queue.clear();
    expect(queue.size).toBe(0);

    target.setRemote(true);
    await queue.add(candidate("b"));
    expect(target.applied).toHaveLength(1);
  });

  it("ignores everything after close, so a dropped peer cannot resurrect", async () => {
    const target = fakeTarget({ remote: true });
    const queue = new RemoteCandidateQueue(target);

    queue.close();
    await queue.add(candidate("a"));
    await queue.flush();

    expect(target.addIceCandidate).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });
});

describe("end-of-candidates handling", () => {
  it("recognises every form the wire can carry", () => {
    expect(isEndOfCandidates(null)).toBe(true);
    expect(isEndOfCandidates({ candidate: "" })).toBe(true);
    expect(isEndOfCandidates({} as RTCIceCandidateInit)).toBe(true);
    expect(isEndOfCandidates(candidate("a"))).toBe(false);
  });

  it("converts null to the empty-string form older stacks accept", () => {
    expect(normalise(null)).toEqual({ candidate: "", sdpMid: "", sdpMLineIndex: 0 });
  });

  it("passes a real candidate through untouched", () => {
    const real = candidate("a");
    expect(normalise(real)).toBe(real);
  });
});
