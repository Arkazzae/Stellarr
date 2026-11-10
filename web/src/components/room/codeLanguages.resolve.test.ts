import { describe, expect, it } from "vitest";

import {
  CODE_LANGUAGES,
  codeLanguageLabel,
  detectCodeLanguage,
  resolveCodeLanguage,
} from "./codeLanguages";

describe("CODE_LANGUAGES", () => {
  it("lists each language once, and no alias belongs to two of them", () => {
    expect(new Set(CODE_LANGUAGES.map((l) => l.id)).size).toBe(CODE_LANGUAGES.length);

    const aliases = CODE_LANGUAGES.flatMap((l) => l.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("has a label for every language", () => {
    expect(codeLanguageLabel("csharp")).toBe("C#");
    expect(codeLanguageLabel("plaintext")).toBe("Plain text");
  });
});

describe("resolveCodeLanguage", () => {
  it("ignores case, paths and what follows the first word", () => {
    expect(resolveCodeLanguage("TS")).toBe("typescript");
    expect(resolveCodeLanguage("  python   title=x ")).toBe("python");
    expect(resolveCodeLanguage("src\\app\\Main.CS")).toBe("csharp");
    expect(resolveCodeLanguage("deploy/Containerfile")).toBe("dockerfile");
  });

  it("falls back to the source when the name says nothing", () => {
    expect(resolveCodeLanguage("", '{"a":1}')).toBe("json");
    expect(resolveCodeLanguage("notes.unknown", "fn main() {}")).toBe("rust");
    expect(resolveCodeLanguage("file.", "SELECT 1 FROM t")).toBe("sql");
    expect(resolveCodeLanguage("")).toBe("plaintext");
  });

  it("trusts an explicit plain-text name over what the code looks like", () => {
    expect(resolveCodeLanguage("txt", '{"a":1}')).toBe("plaintext");
  });
});

describe("detectCodeLanguage", () => {
  const cases: [string, string][] = [
    ["<?php echo 1;", "php"],
    ["<!DOCTYPE html><p>", "html"],
    ["<div class=a>x</div>", "html"],
    ["#!/usr/bin/env bash\necho hi", "bash"],
    ["FROM node:22\nRUN npm ci", "dockerfile"],
    ["UPDATE users SET name = 'x'", "sql"],
    ["package main\n\nfunc main() {}", "go"],
    ["let mut total = 0;", "rust"],
    ["def greet(name):\n    return name", "python"],
    ["using System;\n\nnamespace App;", "csharp"],
    ["interface Props { id: string }", "typescript"],
    ["const room = open();", "javascript"],
    ["items.map(x => x.id)", "javascript"],
    ["name: stellarr\nport: 8080", "yaml"],
    [".card {\n  color: red;\n}", "css"],
    ["## Title\n\ntext", "markdown"],
    ["see [docs](https://example.com)", "markdown"],
    ["", "plaintext"],
    ["   \n  ", "plaintext"],
  ];

  it.each(cases)("%j is %s", (source, expected) => {
    expect(detectCodeLanguage(source)).toBe(expected);
  });

  it("prefers the more specific shape when several fit", () => {
    // Valid JSON, but also starts like a tag-less document: JSON wins over loose rules.
    expect(detectCodeLanguage("[1, 2, 3]")).toBe("json");
    // A shebang beats the shell-looking YAML-ish line below it.
    expect(detectCodeLanguage("#!/bin/sh\nkey: value")).toBe("bash");
    // `<?php` is checked before the generic tag rule.
    expect(detectCodeLanguage("<?php\n<div>")).toBe("php");
  });
});
