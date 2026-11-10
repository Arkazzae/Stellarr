/**
 * The vocabulary of each highlightable language: keyword lists and the comment
 * and string forms its lexer has to know about. Markup and CSS have their own
 * scanners, and plain text and Markdown are never coloured, so none of them is
 * listed here.
 */

import type { CodeLanguageId } from "./codeLanguages";

export interface LanguageSyntax {
  /** Space-separated lists; the tokenizer splits them once per call. */
  keywords?: string;
  types?: string;
  /** Library names, coloured like types. */
  builtins?: string;
  lineComments?: readonly string[];
  blockComments?: readonly (readonly [open: string, close: string])[];
  backticks?: boolean;
  tripleStrings?: boolean;
  /** `name:` at the start of an entry, as in JSON-like and YAML-like data. */
  properties?: boolean;
  caseInsensitive?: boolean;
}

const JS_KEYWORDS =
  "as async await break case catch class const constructor continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield";
const TS_KEYWORDS = `${JS_KEYWORDS} abstract any boolean declare enum implements infer interface keyof module namespace never number object override private protected public readonly satisfies string symbol type unknown`;
const C_KEYWORDS =
  "alignas alignof auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while";
const C_TYPES =
  "bool char double float int int8_t int16_t int32_t int64_t long short signed size_t uint8_t uint16_t uint32_t uint64_t unsigned void wchar_t";

const SLASH_COMMENTS = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]],
} as const;

export const SYNTAX: Partial<Record<CodeLanguageId, LanguageSyntax>> = {
  javascript: {
    keywords: JS_KEYWORDS,
    types:
      "Array BigInt Date Error Map Math Number Object Promise RegExp Set String Symbol WeakMap WeakSet",
    builtins:
      "console document fetch globalThis JSON process require setInterval setTimeout window",
    ...SLASH_COMMENTS,
    backticks: true,
  },
  typescript: {
    keywords: TS_KEYWORDS,
    types:
      "Array BigInt Date Error Map Math Number Object Promise Record RegExp Set String Symbol WeakMap WeakSet",
    builtins:
      "console document fetch globalThis JSON process require setInterval setTimeout window",
    ...SLASH_COMMENTS,
    backticks: true,
  },
  jsx: {
    keywords: JS_KEYWORDS,
    types: "Array Date Error Map Promise React Set String",
    builtins: "console document fetch JSON window",
    ...SLASH_COMMENTS,
    backticks: true,
  },
  tsx: {
    keywords: TS_KEYWORDS,
    types: "Array Date Error Map Promise React Record Set String",
    builtins: "console document fetch JSON window",
    ...SLASH_COMMENTS,
    backticks: true,
  },
  json: { keywords: "false null true", properties: true },
  scss: {
    keywords:
      "and as at-root content debug each else error extend for forward from function if import include mixin not or return use warn while",
    ...SLASH_COMMENTS,
    properties: true,
  },
  bash: {
    keywords:
      "case do done elif else esac export fi for function if in local readonly return select then time until while",
    builtins:
      "alias cd echo eval exec exit printf pwd read set shift source test trap type unset",
    lineComments: ["#"],
    backticks: true,
  },
  powershell: {
    keywords:
      "begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using while",
    builtins:
      "ForEach-Object Get-ChildItem Get-Content Join-Path New-Item Select-Object Set-Content Where-Object Write-Host",
    lineComments: ["#"],
    blockComments: [["<#", "#>"]],
    caseInsensitive: true,
  },
  python: {
    keywords:
      "and as assert async await break case class continue def del elif else except False finally for from global if import in is lambda match None nonlocal not or pass raise return True try while with yield",
    types: "bool bytes dict float frozenset int list object set str tuple type",
    builtins: "enumerate len open print range reversed sorted sum zip",
    lineComments: ["#"],
    tripleStrings: true,
  },
  csharp: {
    keywords:
      "abstract as async await base break case catch checked class const continue default delegate do else enum event explicit extern false finally fixed for foreach from get goto if implicit in init interface internal is lock namespace new null operator out override params partial private protected public readonly record ref required return sealed set sizeof stackalloc static struct switch this throw true try typeof unchecked unsafe using virtual void volatile when where while yield",
    types:
      "bool byte char decimal double dynamic float int long nint nulong object sbyte short string uint ulong ushort var",
    builtins: "Console DateTime Dictionary Enumerable Guid List Math String Task",
    ...SLASH_COMMENTS,
  },
  c: {
    keywords: C_KEYWORDS,
    types: C_TYPES,
    builtins:
      "calloc fclose fopen fprintf free malloc memcpy printf realloc scanf stderr stdin stdout strlen",
    ...SLASH_COMMENTS,
  },
  cpp: {
    keywords: `${C_KEYWORDS} alignas alignof and and_eq asm bitand bitor catch class compl concept consteval constexpr constinit const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export false friend mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw true try typeid typename using virtual xor xor_eq`,
    types: `${C_TYPES} auto nullptr_t std string string_view vector`,
    builtins: "cin cerr cout endl make_shared make_unique move printf",
    ...SLASH_COMMENTS,
  },
  java: {
    keywords:
      "abstract assert break case catch class const continue default do else enum extends false final finally for goto if implements import instanceof interface native new null package private protected public return static strictfp super switch synchronized this throw throws transient true try void volatile while",
    types:
      "Boolean Byte Character Class Double Exception Float Integer Long Object Short String System Throwable Void",
    builtins: "ArrayList Arrays Collections HashMap List Map Math Optional Set Stream",
    ...SLASH_COMMENTS,
  },
  kotlin: {
    keywords:
      "as break by catch class companion const constructor continue crossinline data do else enum expect external false field file finally for fun get if import in infix init inline inner interface internal is lateinit noinline null object open operator out override package private protected public receiver reified return sealed set super suspend tailrec this throw true try typealias typeof val var vararg when where while",
    types: "Any Boolean Byte Char Double Float Int Long Nothing Short String Unit",
    builtins: "arrayOf listOf mapOf mutableListOf println setOf",
    ...SLASH_COMMENTS,
    tripleStrings: true,
  },
  go: {
    keywords:
      "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
    types:
      "bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr",
    builtins:
      "append cap close complex copy delete imag len make new panic print println real recover",
    ...SLASH_COMMENTS,
    backticks: true,
  },
  rust: {
    keywords:
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    types: "bool char f32 f64 i8 i16 i32 i64 i128 isize str String u8 u16 u32 u64 u128 usize Vec",
    builtins: "Box Err None Ok Option Result Some drop format panic print println vec",
    ...SLASH_COMMENTS,
  },
  swift: {
    keywords:
      "as associatedtype break case catch class continue convenience default defer deinit didSet do dynamic else enum extension fallthrough false fileprivate final for func get guard if import in indirect infix init inout internal is lazy let mutating nil nonmutating open operator optional override precedence private protocol public repeat required rethrows return self Self set some static struct subscript super switch throw throws true try typealias unowned var weak where while willSet",
    types: "Any Array Bool Character Dictionary Double Error Float Int Never Optional Set String UInt Void",
    builtins: "assert debugPrint fatalError map print stride zip",
    ...SLASH_COMMENTS,
    tripleStrings: true,
  },
  ruby: {
    keywords:
      "BEGIN END alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
    types:
      "Array Class Exception FalseClass Float Hash Integer Module NilClass Object Range String Symbol TrueClass",
    builtins: "attr_accessor attr_reader attr_writer puts print raise require",
    lineComments: ["#"],
    blockComments: [["=begin", "=end"]],
  },
  php: {
    keywords:
      "abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new null or print private protected public readonly require require_once return static switch throw trait true try unset use var while xor yield",
    types: "bool boolean double float int integer iterable mixed object resource string void",
    builtins: "count explode implode in_array json_decode json_encode print_r strlen var_dump",
    lineComments: ["//", "#"],
    blockComments: [["/*", "*/"]],
  },
  sql: {
    keywords:
      "add all alter and any as asc backup between by case check column constraint create database default delete desc distinct drop exec exists foreign from full group having in index inner insert into is join key left like limit not null or order outer primary procedure right rownum select set table top truncate union unique update values view where with",
    types:
      "bigint binary bit blob boolean char date datetime decimal float int integer json money numeric real serial text time timestamp uuid varchar",
    builtins:
      "avg cast coalesce concat count current_date current_timestamp lower max min now round sum upper",
    lineComments: ["--", "#"],
    blockComments: [["/*", "*/"]],
    caseInsensitive: true,
  },
  yaml: {
    keywords: "false null true yes no on off",
    lineComments: ["#"],
    properties: true,
    caseInsensitive: true,
  },
  dockerfile: {
    keywords:
      "ADD ARG CMD COPY ENTRYPOINT ENV EXPOSE FROM HEALTHCHECK LABEL MAINTAINER ONBUILD RUN SHELL STOPSIGNAL USER VOLUME WORKDIR",
    lineComments: ["#"],
    caseInsensitive: true,
  },
  lua: {
    keywords:
      "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
    builtins:
      "assert collectgarbage dofile error getmetatable ipairs load loadfile next pairs pcall print rawequal rawget rawlen rawset require select setmetatable tonumber tostring type xpcall",
    lineComments: ["--"],
    blockComments: [
      ["--[[", "]]"],
      ["--[=[", "]=]"],
    ],
  },
};
