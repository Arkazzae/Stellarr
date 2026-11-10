/** The slice of `RTCPeerConnection` the queue needs, so it can be tested without WebRTC. */
export interface CandidateTarget {
  /** True once `setRemoteDescription` has been applied at least once. */
  hasRemoteDescription(): boolean;
  addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void>;
}

/**
 * Holds remote ICE candidates until there is a remote description to attach
 * them to, then applies them in arrival order.
 *
 * Candidates routinely beat the description that explains them: the peer starts
 * gathering as soon as it sets its local description, and on a LAN the first
 * host candidate can overtake the offer through the hub. `addIceCandidate`
 * throws `InvalidStateError` in that window and the candidate is lost, usually
 * the host candidate, which is the one that would have connected fastest.
 *
 * Order matters beyond correctness. Candidates are sent in priority order, and
 * applying them shuffled makes ICE work through worse pairs first. Every
 * operation therefore runs on one promise chain, so concurrent calls cannot
 * interleave.
 */
export class RemoteCandidateQueue {
  private readonly pending: Array<RTCIceCandidateInit | null> = [];
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly target: CandidateTarget,
    /** Receives the errors a raced or ignored offer makes unavoidable. */
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** Candidates still waiting for a remote description. */
  get size(): number {
    return this.pending.length;
  }

  /**
   * Queue a candidate; it is applied at once if the description is ready.
   * `null` is the end-of-candidates signal and keeps its place in the sequence.
   * The returned promise never rejects.
   */
  add(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.pending.push(candidate);
    return this.enqueueDrain();
  }

  /** Call after `setRemoteDescription` to apply whatever arrived early. */
  flush(): Promise<void> {
    return this.closed ? Promise.resolve() : this.enqueueDrain();
  }

  /** Drop everything still waiting, e.g. when the peer is replaced. */
  clear(): void {
    this.pending.length = 0;
  }

  /** Permanently stop: a dropped peer must not be resurrected by a late message. */
  close(): void {
    this.closed = true;
    this.clear();
  }

  private enqueueDrain(): Promise<void> {
    this.tail = this.tail.then(() => this.drain());
    return this.tail;
  }

  private async drain(): Promise<void> {
    while (!this.closed && this.pending.length > 0 && this.target.hasRemoteDescription()) {
      // One at a time: the description can be rolled back mid-drain, and what
      // is left must stay queued rather than be lost.
      const next = this.pending.shift() ?? null;
      try {
        await this.target.addIceCandidate(normalise(next));
      } catch (error) {
        // A candidate from an ignored offer is expected to fail, and must not
        // hold back the ones behind it, which may belong to the accepted offer.
        this.onError(error);
      }
    }
  }
}

/**
 * The wire carries `null` for end-of-candidates, and `{candidate: ""}` means the
 * same. Older stacks throw on `null`, so the empty-string form is what gets
 * applied; every stack understands it.
 */
export function normalise(candidate: RTCIceCandidateInit | null): RTCIceCandidateInit {
  return candidate ?? { candidate: "", sdpMid: "", sdpMLineIndex: 0 };
}

/** True when this payload means "that was the last candidate". */
export function isEndOfCandidates(candidate: RTCIceCandidateInit | null): boolean {
  return !candidate || typeof candidate.candidate !== "string" || candidate.candidate === "";
}
