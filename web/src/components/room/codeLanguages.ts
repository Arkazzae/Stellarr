/**
 * The languages a fenced block can be highlighted as, and how a fence's info
 * string (or, failing that, the code itself) picks one.
 *
 * Highlighting is a small lexer rather than a compiler in the transcript: a bad
 * guess may colour the wrong word, but it can never change the source.
 */

export { tokenizeCode } from "./codeTokenizer";

export type CodeTokenKind =
  | "kw"
  | "str"
  | "cm"
  | "num"
  | "type"
  | "fn"
  | "tag"
  | "attr"
  | "text";

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

export type CodeLanguageId =
  | "plaintext"
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "html"
  | "css"
  | "scss"
  | "bash"
  | "powershell"
  | "python"
  | "csharp"
  | "c"
  | "cpp"
  | "java"
  | "kotlin"
  | "go"
  | "rust"
  | "swift"
  | "ruby"
  | "php"
  | "sql"
  | "yaml"
  | "markdown"
  | "dockerfile"
  | "lua";

export interface CodeLanguage {
  id: CodeLanguageId;
  label: string;
  /** Names a fence can use after the backticks, lower case. */
  aliases: readonly string[];
  /** File extensions, without the dot. */
  extensions?: readonly string[];
  /** Whole base names that carry no extension. */
  filenames?: readonly string[];
}

/** In reader-friendly order, because this is also the order of the language select. */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: "plaintext", label: "Plain text", aliases: ["text", "txt", "plain"] },
  {
    id: "javascript",
    label: "JavaScript",
    aliases: ["js", "javascript", "node", "mjs", "cjs"],
    extensions: ["js", "mjs", "cjs"],
  },
  {
    id: "typescript",
    label: "TypeScript",
    aliases: ["ts", "typescript"],
    extensions: ["ts", "mts", "cts"],
  },
  { id: "jsx", label: "JSX", aliases: ["jsx"], extensions: ["jsx"] },
  { id: "tsx", label: "TSX", aliases: ["tsx"], extensions: ["tsx"] },
  { id: "json", label: "JSON", aliases: ["json", "jsonc"], extensions: ["json", "jsonc"] },
  {
    id: "html",
    label: "HTML / XML",
    aliases: ["html", "xml", "svg", "vue", "svelte"],
    extensions: ["html", "htm", "xml", "svg", "vue", "svelte"],
  },
  { id: "css", label: "CSS", aliases: ["css"], extensions: ["css"] },
  { id: "scss", label: "SCSS", aliases: ["scss", "sass"], extensions: ["scss", "sass"] },
  {
    id: "bash",
    label: "Shell / Bash",
    aliases: ["sh", "shell", "bash", "zsh", "fish", "console"],
    extensions: ["sh", "bash", "zsh", "fish"],
  },
  {
    id: "powershell",
    label: "PowerShell",
    aliases: ["ps", "ps1", "powershell"],
    extensions: ["ps1", "psm1", "psd1"],
  },
  { id: "python", label: "Python", aliases: ["py", "python"], extensions: ["py", "pyw"] },
  {
    id: "csharp",
    label: "C#",
    aliases: ["cs", "csharp", "dotnet"],
    extensions: ["cs", "csx"],
  },
  { id: "c", label: "C", aliases: ["c"], extensions: ["c", "h"] },
  {
    id: "cpp",
    label: "C++",
    aliases: ["cpp", "c++", "cc", "cplusplus"],
    extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"],
  },
  { id: "java", label: "Java", aliases: ["java"], extensions: ["java"] },
  { id: "kotlin", label: "Kotlin", aliases: ["kt", "kotlin"], extensions: ["kt", "kts"] },
  { id: "go", label: "Go", aliases: ["go", "golang"], extensions: ["go"] },
  { id: "rust", label: "Rust", aliases: ["rs", "rust"], extensions: ["rs"] },
  { id: "swift", label: "Swift", aliases: ["swift"], extensions: ["swift"] },
  { id: "ruby", label: "Ruby", aliases: ["rb", "ruby"], extensions: ["rb", "rake"] },
  { id: "php", label: "PHP", aliases: ["php"], extensions: ["php", "phtml"] },
  { id: "sql", label: "SQL", aliases: ["sql"], extensions: ["sql"] },
  { id: "yaml", label: "YAML", aliases: ["yaml", "yml"], extensions: ["yaml", "yml"] },
  {
    id: "markdown",
    label: "Markdown",
    aliases: ["md", "markdown", "mdx"],
    extensions: ["md", "mdx"],
  },
  {
    id: "dockerfile",
    label: "Dockerfile",
    aliases: ["docker", "dockerfile"],
    filenames: ["dockerfile", "containerfile"],
  },
  { id: "lua", label: "Lua", aliases: ["lua"], extensions: ["lua"] },
];

/** Maps every name a language answers to (as chosen by `names`) to its id. */
function indexNames(
  names: (language: CodeLanguage) => readonly string[] | undefined,
): ReadonlyMap<string, CodeLanguageId> {
  return new Map(
    CODE_LANGUAGES.flatMap((language) =>
      (names(language) ?? []).map((name) => [name, language.id] as const),
    ),
  );
}

const LABELS = new Map(CODE_LANGUAGES.map((language) => [language.id, language.label]));
const BY_ALIAS = indexNames((language) => language.aliases);
const BY_EXTENSION = indexNames((language) => language.extensions);
const BY_FILENAME = indexNames((language) => language.filenames);

export function codeLanguageLabel(id: CodeLanguageId): string {
  return LABELS.get(id) ?? "Plain text";
}

/**
 * Picks a language from a fence's info string: a conventional alias (`ts`,
 * `{.py}`, `language-js`) or a file name (`worker.ts`, `Dockerfile`). Anything
 * after the first word is ignored, and an unrecognised or missing name falls
 * back to looking at `source`.
 */
export function resolveCodeLanguage(info: string, source = ""): CodeLanguageId {
  const name = (info.trim().split(/\s+/, 1)[0] ?? "")
    .toLowerCase()
    .replace(/^\{\.?|\}$/g, "")
    .replace(/^language-/, "");

  const byAlias = BY_ALIAS.get(name);
  if (byAlias !== undefined) return byAlias;

  const basename = name.split(/[\\/]/).at(-1) ?? name;
  const byFilename = BY_FILENAME.get(basename);
  if (byFilename !== undefined) return byFilename;

  const dot = basename.lastIndexOf(".");
  const byExtension = dot >= 0 ? BY_EXTENSION.get(basename.slice(dot + 1)) : undefined;
  return byExtension ?? detectCodeLanguage(source);
}

/** `RegExp` fits, as does anything else that can look at a paste and say yes or no. */
interface Probe {
  test(text: string): boolean;
}

const looksLikeJson: Probe = {
  test(text) {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Tried in order, first yes wins, so the order is part of the behaviour: the
 * specific, cheap-to-confirm shapes come first and the loose ones last.
 */
const DETECTION: readonly (readonly [CodeLanguageId, Probe])[] = [
  ["php", /^<\?php\b/i],
  ["html", /^(?:<!doctype\s+html|<\/?[a-z][\w:-]*(?:\s|>|\/))/i],
  ["bash", /^#!.*\b(?:ba|z|fi)?sh\b/m],
  ["dockerfile", /^\s*(?:FROM|RUN|COPY|ENTRYPOINT|CMD|WORKDIR)\b/im],
  ["json", looksLikeJson],
  ["sql", /\b(?:SELECT|INSERT\s+INTO|UPDATE|CREATE\s+TABLE)\b[\s\S]*\b(?:FROM|VALUES|SET|TABLE)\b/i],
  ["go", /^\s*(?:package\s+\w+|func\s+\w+\s*\()/m],
  ["rust", /\bfn\s+\w+\s*\(|\blet\s+mut\b|\bimpl\s+\w+/m],
  ["python", /^\s*(?:def|class)\s+\w+.*:\s*$|^\s*from\s+\S+\s+import\s+/m],
  ["csharp", /\busing\s+System(?:\.|;)|\bnamespace\s+[\w.]+\s*[;{]/m],
  ["typescript", /^\s*(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)(?:\W|$)/m],
  ["javascript", /\b(?:const|let|var|function)\s+[A-Za-z_$]|=>/m],
  ["yaml", /^[\w.-]+:\s+(?:[^\n{}]+|$)/m],
  ["css", /^[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*[\w-]+\s*:/m],
  ["markdown", /^#{1,6}\s+\S|\[[^\]]+\]\([^)]+\)/m],
];

/** A conservative guess for a fence without an info string. */
export function detectCodeLanguage(source: string): CodeLanguageId {
  const text = source.trim();
  return DETECTION.find(([, probe]) => probe.test(text))?.[0] ?? "plaintext";
}
