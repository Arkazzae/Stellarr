import { describe, expect, it } from "vitest";

import { jsonResponse, mockFetch, noContent, sentRequest } from "@/test/http";

import { ApiError } from "../errors";
import {
  deleteResource,
  fileForm,
  getJson,
  parseList,
  postForm,
  route,
  sendJson,
  sendVoid,
  withQuery,
} from "./http";

const fetchMock = mockFetch();

const parseName = (value: unknown, path: string): string => {
  if (typeof value !== "string") throw new ApiError("malformed", `${path} is not a name`);
  return value;
};

describe("route", () => {
  it("keeps the fixed parts and encodes what is interpolated", () => {
    expect(route`/api/channels/${"a/b"}/messages/${"m?1"}`).toBe(
      "/api/channels/a%2Fb/messages/m%3F1",
    );
  });

  it("encodes a value that already looks encoded", () => {
    expect(route`/api/emoji/${"100%"}`).toBe("/api/emoji/100%25");
  });

  it("returns a route without values as it is", () => {
    expect(route`/api/servers`).toBe("/api/servers");
  });
});

describe("withQuery", () => {
  it("leaves the route alone when no parameter is set", () => {
    expect(withQuery("/api/x", { cursor: undefined, limit: undefined })).toBe("/api/x");
  });

  it("encodes the values and skips the unset ones", () => {
    expect(withQuery("/api/x", { cursor: "a+b/c=", limit: 25, query: undefined })).toBe(
      "/api/x?cursor=a%2Bb%2Fc%3D&limit=25",
    );
  });

  it("keeps a zero", () => {
    expect(withQuery("/api/x", { beforeSequence: 0 })).toBe("/api/x?beforeSequence=0");
  });
});

describe("parseList", () => {
  it("reads every element and names it in the path", () => {
    expect(parseList(parseName)(["a", "b"], "/api/x")).toEqual(["a", "b"]);
    expect(() => parseList(parseName)(["a", 1], "/api/x")).toThrow("/api/x[] is not a name");
  });

  it("rejects an answer that is not a list", () => {
    expect(() => parseList(parseName)({}, "/api/x")).toThrow(ApiError);
  });
});

describe("getJson", () => {
  it("asks for JSON and parses the answer under the request path", async () => {
    fetchMock.mockResolvedValue(jsonResponse("hello"));

    await expect(getJson("/api/x", parseName)).resolves.toBe("hello");

    const sent = sentRequest(fetchMock);
    expect(sent.method).toBe("GET");
    expect(sent.headers.get("Accept")).toBe("application/json");
    expect(sent.headers.has("Content-Type")).toBe(false);
  });

  it("fails by status", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(getJson("/api/x", parseName)).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
    });
  });

  it("reports a body that is not JSON as malformed", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getJson("/api/x", parseName)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("hands the abort signal to fetch", async () => {
    fetchMock.mockResolvedValue(jsonResponse("hello"));
    const controller = new AbortController();

    await getJson("/api/x", parseName, controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe("sendJson", () => {
  it("sends the body as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse("saved"));

    await expect(sendJson("PATCH", "/api/x", { name: "n" }, parseName)).resolves.toBe("saved");

    const sent = sentRequest(fetchMock);
    expect(sent.method).toBe("PATCH");
    expect(sent.body).toEqual({ name: "n" });
    expect(sent.headers.get("Content-Type")).toBe("application/json");
  });

  it("sends no body and no content type when there is nothing to say", async () => {
    fetchMock.mockResolvedValue(jsonResponse("saved"));

    await sendJson("POST", "/api/x", undefined, parseName);

    const sent = sentRequest(fetchMock);
    expect(sent.body).toBeUndefined();
    expect(sent.headers.has("Content-Type")).toBe(false);
    expect(sent.headers.get("Accept")).toBe("application/json");
  });

  it("fails by status", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    await expect(sendJson("POST", "/api/x", {}, parseName)).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });
});

describe("sendVoid", () => {
  it("resolves without reading the answer", async () => {
    fetchMock.mockResolvedValue(noContent());
    await expect(sendVoid("DELETE", "/api/x")).resolves.toBeUndefined();
    expect(sentRequest(fetchMock).method).toBe("DELETE");
  });

  it("fails on a 404, which here means the target does not exist", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(sendVoid("DELETE", "/api/x")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("carries the code of a refusal that gives one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ title: "Confirm first.", code: "fresh-mfa-required" }, 403));
    await expect(sendVoid("POST", "/api/x", {})).rejects.toMatchObject({
      kind: "forbidden",
      status: 403,
      code: "fresh-mfa-required",
    });
  });

  it("leaves the code out of a refusal without one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ title: "No." }, 403));
    const error = await sendVoid("POST", "/api/x", {}).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBeUndefined();
  });
});

describe("deleteResource", () => {
  it("counts a resource that is already gone as deleted", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteResource("/api/x")).resolves.toBeUndefined();
  });

  it("still fails on any other refusal", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(deleteResource("/api/x")).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("carries the code of a refusal that gives one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: "fresh-mfa-required" }, 403));
    await expect(deleteResource("/api/x")).rejects.toMatchObject({ code: "fresh-mfa-required" });
  });
});

describe("postForm", () => {
  it("posts the form without a content type, so the browser adds the boundary", async () => {
    fetchMock.mockResolvedValue(jsonResponse("uploaded", 201));
    const form = fileForm(new File(["x"], "pic.png", { type: "image/png" }));

    await expect(postForm("/api/x", form, parseName)).resolves.toBe("uploaded");

    const sent = sentRequest(fetchMock);
    expect(sent.method).toBe("POST");
    expect(sent.body).toBe(form);
    expect(sent.headers.has("Content-Type")).toBe(false);
    expect((sent.body as FormData).get("file")).toMatchObject({ name: "pic.png" });
  });
});

describe("fileForm", () => {
  it("puts the fields ahead of the file", () => {
    const form = fileForm(new File(["x"], "pic.png"), { shortcode: "pepe" });
    expect([...form.keys()]).toEqual(["shortcode", "file"]);
  });
});
