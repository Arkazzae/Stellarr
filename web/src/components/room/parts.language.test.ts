import { afterEach, describe, expect, it } from "vitest";

import { message } from "@/test/messages";

import { toParts } from "./parts";

const WITHOUT_EXTENSION = {
  id: "a1",
  url: "https://cdn/a1",
  name: "README",
  contentType: "application/octet-stream",
  size: 12,
};

afterEach(() => {
  document.documentElement.lang = "pl";
});

describe("the badge of a file with no extension", () => {
  it("says what the caller passed, whatever language the page is in", () => {
    document.documentElement.lang = "pl";

    const parts = toParts(message("m1", 1, { content: "", attachments: [WITHOUT_EXTENSION] }), {
      extFallback: "FILE",
    });

    expect(parts).toMatchObject([{ kind: "file", name: "README", ext: "FILE" }]);
  });

  it("follows the page's language when the caller passed nothing", () => {
    document.documentElement.lang = "en";

    const parts = toParts(message("m1", 1, { content: "", attachments: [WITHOUT_EXTENSION] }));

    expect(parts).toMatchObject([{ kind: "file", ext: "FILE" }]);
  });

  it("is not used for a file that has one", () => {
    const parts = toParts(
      message("m1", 1, {
        content: "",
        attachments: [{ ...WITHOUT_EXTENSION, name: "report.pdf" }],
      }),
      { extFallback: "FILE" },
    );

    expect(parts).toMatchObject([{ kind: "file", ext: "PDF" }]);
  });
});
