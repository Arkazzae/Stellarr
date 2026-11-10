import { describe, expect, it } from "vitest";

import type { Channel, VoiceOccupant } from "@/ports";

import { sameOccupancy, serverMark, spliceGroupOrder } from "./directoryView";

const channel = (id: string): Channel => ({ id, name: id, kind: "text" });
const occupant = (userId: string): VoiceOccupant => ({ userId, displayName: userId, muted: false });

describe("spliceGroupOrder", () => {
  const channels = ["a", "b", "c", "d", "e"].map(channel);

  it("puts the new order into the slots the group already held", () => {
    expect(spliceGroupOrder(channels, ["d", "b"])).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("leaves the order alone when the group keeps its sequence", () => {
    expect(spliceGroupOrder(channels, ["b", "d"])).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("sameOccupancy", () => {
  it("treats two empty lists as the same answer", () => {
    expect(sameOccupancy(new Map([["v", []]]), new Map([["v", []]]))).toBe(true);
  });

  it("sees a person arrive", () => {
    expect(sameOccupancy(new Map([["v", []]]), new Map([["v", [occupant("ada")]]]))).toBe(false);
  });

  it("sees a different set of channels", () => {
    expect(sameOccupancy(new Map([["v", []]]), new Map([["w", []]]))).toBe(false);
    expect(sameOccupancy(new Map(), new Map([["v", []]]))).toBe(false);
  });

  it("is satisfied by the very same list", () => {
    const list = [occupant("ada")];

    expect(sameOccupancy(new Map([["v", list]]), new Map([["v", list]]))).toBe(true);
  });
});

describe("serverMark", () => {
  it.each([
    ["Orbit", "OR"],
    ["Nocna zmiana", "NZ"],
    ["  spaced   out  ", "SO"],
    ["", "ST"],
  ])("marks %j as %s", (name, mark) => {
    expect(serverMark(name)).toBe(mark);
  });
});
