import { describe, expect, it } from "vitest";

import {
  detectCodeLanguage,
  resolveCodeLanguage,
  tokenizeCode,
} from "./codeLanguages";

describe("code language resolution", () => {
  it("understands aliases, markdown classes, filenames and special basenames", () => {
    expect(resolveCodeLanguage("ts")).toBe("typescript");
    expect(resolveCodeLanguage("{.py}")).toBe("python");
    expect(resolveCodeLanguage("language-js title=worker")).toBe("javascript");
    expect(resolveCodeLanguage("src/Room.tsx")).toBe("tsx");
    expect(resolveCodeLanguage("Dockerfile")).toBe("dockerfile");
  });

  it("conservatively detects common unlabelled pastes", () => {
    expect(detectCodeLanguage('{"ready":true}')).toBe("json");
    expect(detectCodeLanguage("def greet(name):\n    print(name)")).toBe("python");
    expect(detectCodeLanguage("SELECT id FROM messages WHERE id = 1")).toBe("sql");
    expect(detectCodeLanguage("zwykłe zdanie bez składni")).toBe("plaintext");
  });
});

describe("tokenizeCode", () => {
  it("preserves the exact source for every language", () => {
    const source = "# uwaga\ndef greet(name: str):\n    print(\"hej\", name)";
    const tokens = tokenizeCode(source, "python");

    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens).toEqual(expect.arrayContaining([
      { kind: "cm", text: "# uwaga" },
      { kind: "kw", text: "def" },
      { kind: "type", text: "str" },
      { kind: "str", text: "\"hej\"" },
    ]));
  });

  it("uses language-specific, case-insensitive SQL keywords", () => {
    const tokens = tokenizeCode("select count(*) FROM events -- dziś", "sql");
    expect(tokens.filter((token) => token.kind === "kw").map((token) => token.text))
      .toEqual(["select", "FROM"]);
    expect(tokens.some((token) => token.kind === "fn" && token.text === "count"))
      .toBe(false);
    expect(tokens.some((token) => token.kind === "type" && token.text === "count"))
      .toBe(true);
    expect(tokens.at(-1)).toEqual({ kind: "cm", text: "-- dziś" });
  });

  it("distinguishes markup tags and attributes", () => {
    const tokens = tokenizeCode('<button aria-label="Start">OK</button>', "html");
    expect(tokens.some((token) => token.kind === "tag" && token.text === "<button"))
      .toBe(true);
    expect(tokens.some((token) => token.kind === "attr" && token.text === "aria-label"))
      .toBe(true);
  });
});
