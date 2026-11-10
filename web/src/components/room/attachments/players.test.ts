import { describe, expect, it } from "vitest";

import { playerSource, providerLabel } from "./players";

describe("playerSource", () => {
  it("frames YouTube on the no-cookie host", () => {
    const { url, supported } = playerSource({
      provider: "youtube",
      providerId: "aqz-KE-bpKQ",
    });
    expect(supported).toBe(true);
    expect(new URL(url).host).toBe("www.youtube-nocookie.com");
    expect(new URL(url).pathname).toBe("/embed/aqz-KE-bpKQ");
    expect(new URL(url).searchParams.has("modestbranding")).toBe(false);
  });

  it("asks Vimeo not to track", () => {
    const { url } = playerSource({ provider: "vimeo", providerId: "123456789" });
    expect(new URL(url).searchParams.get("dnt")).toBe("1");
  });

  it("carries the start timestamp", () => {
    const youtube = playerSource({
      provider: "youtube",
      providerId: "eRsGyueVLvQ",
      startSeconds: 95,
    });
    expect(new URL(youtube.url).searchParams.get("start")).toBe("95");

    const vimeo = playerSource({
      provider: "vimeo",
      providerId: "123456789",
      startSeconds: 95,
    });
    expect(new URL(vimeo.url).searchParams.get("t")).toBe("95s");
  });

  it("leaves out a start of zero rather than sending one", () => {
    const { url } = playerSource({
      provider: "youtube",
      providerId: "aqz-KE-bpKQ",
      startSeconds: 0,
    });
    expect(new URL(url).searchParams.has("start")).toBe(false);
  });

  it("autoplays only when told to", () => {
    const quiet = playerSource({
      provider: "youtube",
      providerId: "aqz-KE-bpKQ",
      autoplay: false,
    });
    expect(new URL(quiet.url).searchParams.get("autoplay")).toBe("0");
  });

  it("escapes an id rather than pasting it into the path", () => {
    const { url } = playerSource({
      provider: "youtube",
      providerId: "../../evil?x=1",
    });
    expect(new URL(url).pathname).toBe("/embed/..%2F..%2Fevil%3Fx%3D1");
  });

  it("reports an unknown provider instead of guessing at a URL", () => {
    const { url, supported } = playerSource({ provider: "dailymotion", providerId: "x" });
    expect(supported).toBe(false);
    expect(url).toBe("");
  });
});

describe("providerLabel", () => {
  it("names the ones we know", () => {
    expect(providerLabel("youtube")).toBe("YouTube");
    expect(providerLabel("vimeo")).toBe("Vimeo");
  });

  it("falls back to the raw provider", () => {
    expect(providerLabel("example.org")).toBe("example.org");
  });
});
