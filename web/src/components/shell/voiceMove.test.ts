import { describe, expect, it } from "vitest";

import { voiceMoveRequest } from "./voiceMove";

const jo = { id: "u-2", displayName: "Jo", initials: "JO", presence: "online" as const };
const occupant = { type: "voice-occupant", person: jo, sourceChannelId: "v-1" };

describe("voiceMoveRequest", () => {
  it("ignores a drop back onto the channel the person already sits in", () => {
    expect(
      voiceMoveRequest(occupant, { type: "voice-channel", channelId: "v-1" }),
    ).toBeNull();
  });

  it("ignores a drag that is not an occupant or a drop that is not a voice channel", () => {
    const target = { type: "voice-channel", channelId: "v-2" };

    expect(voiceMoveRequest({ type: "text-channel" }, target)).toBeNull();
    expect(voiceMoveRequest(occupant, { type: "text-channel" })).toBeNull();
    expect(voiceMoveRequest(occupant, undefined)).toBeNull();
    expect(voiceMoveRequest(null, target)).toBeNull();
    expect(voiceMoveRequest("voice-occupant", target)).toBeNull();
  });
});
