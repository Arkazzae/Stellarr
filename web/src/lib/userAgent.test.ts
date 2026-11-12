import { describe, expect, it } from "vitest";

import { describeUserAgent } from "./userAgent";

describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      { browser: "Chrome", system: "macOS" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
      { browser: "Edge", system: "Windows" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
      { browser: "Firefox", system: "Linux" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1",
      { browser: "Safari", system: "iOS" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
      { browser: "Chrome", system: "Android" },
    ],
  ])("names the browser and system of %s", (agent, expected) => {
    expect(describeUserAgent(agent)).toEqual(expected);
  });

  it("leaves out what it does not recognise", () => {
    expect(describeUserAgent("curl/8.7.1")).toEqual({});
  });
});
