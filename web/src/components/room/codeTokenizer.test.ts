import { describe, expect, it } from "vitest";

import { CODE_LANGUAGES, tokenizeCode, type CodeToken } from "./codeLanguages";

const spelled = (tokens: CodeToken[]) => tokens.map((token) => token.text).join("");
const ofKind = (tokens: CodeToken[], kind: CodeToken["kind"]) =>
  tokens.filter((token) => token.kind === kind).map((token) => token.text);

describe("tokenizeCode", () => {
  it("spells the exact source back for every language, even for broken input", () => {
    const samples = [
      "const π = `tpl ${x}\n` + 'a\\'b'; // zażółć\n/* open",
      "<div class=\"a\" data-x='1'>&amp; <!-- c --> text</div",
      "a { color: #FFF; margin: -1.5rem; } @media (x) { b::after { content: \"\\\"\" } }",
      "\"\"\"never closed\nif x: pass # tail",
      "   \n\t",
    ];
    for (const { id } of CODE_LANGUAGES) {
      for (const sample of samples) expect(spelled(tokenizeCode(sample, id))).toBe(sample);
    }
  });

  it("returns nothing for an empty source and one plain run for uncoloured languages", () => {
    expect(tokenizeCode("")).toEqual([]);
    expect(tokenizeCode("", "html")).toEqual([]);
    for (const id of ["plaintext", "markdown"] as const) {
      expect(tokenizeCode("const a = 1; # **b**", id)).toEqual([
        { kind: "text", text: "const a = 1; # **b**" },
      ]);
    }
  });

  it("defaults to TypeScript", () => {
    expect(tokenizeCode("const answer: number = 42")).toEqual([
      { kind: "kw", text: "const" },
      { kind: "text", text: " answer: " },
      { kind: "kw", text: "number" },
      { kind: "text", text: " = " },
      { kind: "num", text: "42" },
    ]);
  });

  it("colours a keyword as a keyword and a library name as a type, never as a call", () => {
    const tokens = tokenizeCode("if (ok) { console.log(String(1)); render (x); }", "javascript");

    expect(ofKind(tokens, "kw")).toEqual(["if"]);
    expect(ofKind(tokens, "type")).toEqual(["console", "String"]);
    expect(ofKind(tokens, "fn")).toEqual(["log", "render"]);
  });

  it("matches case-insensitive languages whatever the case", () => {
    expect(ofKind(tokenizeCode("FOREACH ($x in $y) { Write-Host $x }", "powershell"), "kw"))
      .toEqual(["FOREACH", "in"]);
    expect(ofKind(tokenizeCode("run echo\nRUN ls", "dockerfile"), "kw")).toEqual(["run", "RUN"]);
  });

  it("keeps template literals and triple-quoted strings in one piece", () => {
    expect(ofKind(tokenizeCode("x = `a\nb ${c}`", "javascript"), "str")).toEqual(["`a\nb ${c}`"]);
    expect(ofKind(tokenizeCode('s = """a\n"b"\n"""', "python"), "str")).toEqual(['"""a\n"b"\n"""']);
  });

  it("does not let an unterminated comment or string swallow the rest", () => {
    const tokens = tokenizeCode("a /* open\nconst b = 1", "typescript");

    expect(ofKind(tokens, "cm")).toEqual([]);
    expect(ofKind(tokens, "kw")).toEqual(["const"]);
  });

  it("colours keys of data languages as attributes and leaves quoted JSON keys as strings", () => {
    expect(ofKind(tokenizeCode("name: stellarr # chat\nok: yes", "yaml"), "attr"))
      .toEqual(["name", "ok"]);

    const json = tokenizeCode('{"ready": true, "n": 2.5e3}', "json");
    expect(ofKind(json, "str")).toEqual(['"ready"', '"n"']);
    expect(ofKind(json, "kw")).toEqual(["true"]);
    expect(ofKind(json, "num")).toEqual(["2.5e3"]);
  });

  it("tokenises CSS rules, at-rules, colours and functions", () => {
    const tokens = tokenizeCode(
      "@media (min-width: 40rem) { .a { color: #fff; width: calc(100% - 1px); --gap: 4px } }",
      "css",
    );

    expect(ofKind(tokens, "kw")).toEqual(["@media"]);
    expect(ofKind(tokens, "attr")).toEqual(["min-width", "color", "width", "--gap"]);
    expect(ofKind(tokens, "str")).toEqual(["#fff"]);
    expect(ofKind(tokens, "fn")).toEqual(["calc"]);
    expect(ofKind(tokens, "num")).toEqual(expect.arrayContaining(["40rem", "1px", "4px"]));
  });

  it("tokenises markup entities, comments and quoted values", () => {
    const tokens = tokenizeCode('<a href="/x">&amp;&#38;</a><!-- note -->', "html");

    expect(ofKind(tokens, "tag")).toEqual(["<a", ">", "</a>"]);
    expect(ofKind(tokens, "attr")).toEqual(["href"]);
    expect(ofKind(tokens, "str")).toEqual(['"/x"', "&amp;&#38;"]);
    expect(ofKind(tokens, "cm")).toEqual(["<!-- note -->"]);
  });

  it("ends a markup comment where a browser does", () => {
    const comments = (source: string) => ofKind(tokenizeCode(source, "html"), "cm");

    expect(comments("<!-- a --!><b>")).toEqual(["<!-- a --!>"]);
    expect(comments("<!--><b>")).toEqual(["<!-->"]);
    expect(comments("<!---><b>")).toEqual(["<!--->"]);
    expect(ofKind(tokenizeCode("<!-- a --!><b>", "html"), "tag")).toEqual(["<b>"]);
  });

  it("never produces two neighbouring tokens of one kind", () => {
    for (const { id } of CODE_LANGUAGES) {
      const tokens = tokenizeCode("let a = 1\n\nlet b = 'x' 'y' // z\n// w", id);
      tokens.forEach((token, index) => {
        expect(token.text).not.toBe("");
        expect(token.kind).not.toBe(tokens[index + 1]?.kind);
      });
    }
  });
});
