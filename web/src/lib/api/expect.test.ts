import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  definedField,
  expectArray,
  expectBoolean,
  expectNumber,
  expectRecord,
  expectSafeInteger,
  expectString,
  isRecord,
  optionalList,
  optionalNumber,
  optionalString,
  stringArray,
  unwrap,
} from "./expect";

function malformedMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("malformed");
    return (error as ApiError).message;
  }
  throw new Error("expected the call to throw");
}

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("text")).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("unwrap", () => {
  it("opens a single-key envelope", () => {
    expect(unwrap({ user: { id: "u-1" } }, "user")).toEqual({ id: "u-1" });
  });

  it("returns a bare entity as it is", () => {
    expect(unwrap({ id: "u-1" }, "user")).toEqual({ id: "u-1" });
    expect(unwrap(null, "user")).toBeNull();
  });

  it("keeps an explicit null inside the envelope", () => {
    expect(unwrap({ user: null }, "user")).toBeNull();
  });
});

describe("expectRecord and expectArray", () => {
  it("return what they were given", () => {
    const record = { a: 1 };
    const list = [1, 2];

    expect(expectRecord(record, "/p")).toBe(record);
    expect(expectArray(list, "/p")).toBe(list);
  });

  it("name the path when the shape is wrong", () => {
    expect(malformedMessage(() => expectRecord([], "/api/x"))).toContain("/api/x");
    expect(malformedMessage(() => expectArray({}, "/api/y"))).toContain("/api/y");
  });
});

describe("required fields", () => {
  it("reads strings, finite numbers, booleans and safe integers", () => {
    const source = { s: "text", n: 1.5, b: false, i: 7 };

    expect(expectString(source, "s", "/p")).toBe("text");
    expect(expectNumber(source, "n", "/p")).toBe(1.5);
    expect(expectBoolean(source, "b", "/p")).toBe(false);
    expect(expectSafeInteger(source, "i", "/p")).toBe(7);
  });

  it("name the field and the path when it is missing or of another type", () => {
    const message = malformedMessage(() => expectString({ s: 1 }, "s", "/api/x"));

    expect(message).toContain("/api/x");
    expect(message).toContain('"s"');
    expect(() => expectString({}, "s", "/p")).toThrow(ApiError);
    expect(() => expectBoolean({ b: "true" }, "b", "/p")).toThrow(ApiError);
  });

  it("refuse numbers that are not finite", () => {
    expect(() => expectNumber({ n: Number.NaN }, "n", "/p")).toThrow(ApiError);
    expect(() => expectNumber({ n: Infinity }, "n", "/p")).toThrow(ApiError);
    expect(() => expectNumber({ n: "3" }, "n", "/p")).toThrow(ApiError);
  });

  it("refuse integers that are fractional, unsafe or below the minimum", () => {
    expect(() => expectSafeInteger({ i: 1.5 }, "i", "/p")).toThrow(ApiError);
    expect(() => expectSafeInteger({ i: 2 ** 53 }, "i", "/p")).toThrow(ApiError);
    expect(() => expectSafeInteger({ i: -1 }, "i", "/p")).toThrow(ApiError);
    expect(() => expectSafeInteger({ i: 0 }, "i", "/p", 1)).toThrow(ApiError);
    expect(expectSafeInteger({ i: 1 }, "i", "/p", 1)).toBe(1);
  });
});

describe("optional fields", () => {
  it("are undefined unless the value has the right type", () => {
    expect(optionalString({ s: "x" }, "s")).toBe("x");
    expect(optionalString({ s: 3 }, "s")).toBeUndefined();
    expect(optionalString({}, "s")).toBeUndefined();
    expect(optionalNumber({ n: 0 }, "n")).toBe(0);
    expect(optionalNumber({ n: Number.NaN }, "n")).toBeUndefined();
    expect(optionalNumber({ n: "1" }, "n")).toBeUndefined();
  });
});

describe("stringArray", () => {
  it("keeps the strings of a list and nothing else", () => {
    expect(stringArray(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(stringArray("a")).toEqual([]);
    expect(stringArray(undefined)).toEqual([]);
  });
});

describe("optionalList", () => {
  const parseId = (item: unknown, path: string): string => expectString(expectRecord(item, path), "id", path);

  it("parses every item of a list", () => {
    expect(optionalList([{ id: "a" }, { id: "b" }], "/p[]", parseId)).toEqual(["a", "b"]);
  });

  it("reads anything that is not a list as empty", () => {
    expect(optionalList(undefined, "/p[]", parseId)).toEqual([]);
    expect(optionalList(null, "/p[]", parseId)).toEqual([]);
    expect(optionalList({ id: "a" }, "/p[]", parseId)).toEqual([]);
  });

  it("still rejects a malformed item, naming the path it was given", () => {
    expect(malformedMessage(() => optionalList([{ id: "a" }, {}], "/p[]", parseId))).toContain("/p[]");
  });
});

describe("definedField", () => {
  it("adds the field only when it has a value", () => {
    expect({ id: "1", ...definedField("width", 0) }).toStrictEqual({ id: "1", width: 0 });
    expect({ id: "1", ...definedField("width", undefined) }).toStrictEqual({ id: "1" });
  });
});
