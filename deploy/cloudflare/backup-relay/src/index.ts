interface Env {
  BACKUPS: R2Bucket;
  BACKUP_TOKEN: string;
}

const KEY_HEADER = "X-Stellarr-Key";
const SHA_HEADER = "X-Stellarr-Sha256";
const SIZE_HEADER = "X-Stellarr-Size";
const MAX_KEY_LENGTH = 512;

/**
 * A small relay between Stellarr and a private R2 bucket. Stellarr uploads a
 * completed archive with a bearer token; the Worker writes it through its R2
 * binding, so the container never needs R2 S3 credentials.
 *
 * The protocol is deliberately tiny: PUT/HEAD/GET on /object, with the object
 * key in X-Stellarr-Key and the digest in X-Stellarr-Sha256. Existing objects
 * with the same digest are left untouched; a different digest is a conflict.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return request.method === "GET"
        ? json({ ok: true }, 200)
        : problem(405, "method-not-allowed");
    }

    if (url.pathname !== "/object") return problem(404, "not-found");
    if (!(await authorized(request.headers.get("Authorization"), env.BACKUP_TOKEN))) {
      return problem(401, "unauthorized");
    }

    const key = request.headers.get(KEY_HEADER);
    if (!isSafeKey(key)) return problem(400, "invalid-key");

    switch (request.method) {
      case "PUT":
        return putObject(request, env, key);
      case "HEAD":
        return headObject(env, key);
      case "GET":
        return getObject(env, key);
      default:
        return problem(405, "method-not-allowed");
    }
  },
} satisfies ExportedHandler<Env>;

async function putObject(request: Request, env: Env, key: string): Promise<Response> {
  const digest = request.headers.get(SHA_HEADER)?.toLowerCase();
  if (!digest || !/^[0-9a-f]{64}$/.test(digest)) return problem(400, "invalid-sha256");
  if (!request.body) return problem(400, "missing-body");

  // A retried upload with the same archive is already complete. Never
  // overwrite an object with different content: that needs an operator.
  const existing = await env.BACKUPS.head(key);
  if (existing) {
    if (existing.customMetadata?.sha256 === digest) {
      return json({ status: "unchanged", key, size: existing.size }, 200);
    }
    return problem(409, "object-exists-with-different-metadata");
  }

  const object = await env.BACKUPS.put(key, request.body, {
    httpMetadata: { contentType: "application/zip" },
    customMetadata: { sha256: digest },
  });
  return json({ status: "created", key, size: object.size }, 201);
}

async function headObject(env: Env, key: string): Promise<Response> {
  const object = await env.BACKUPS.head(key);
  if (!object) return problem(404, "not-found");
  return new Response(null, {
    headers: {
      [SIZE_HEADER]: String(object.size),
      [SHA_HEADER]: object.customMetadata?.sha256 ?? "",
      "Cache-Control": "no-store",
    },
  });
}

async function getObject(env: Env, key: string): Promise<Response> {
  const object = await env.BACKUPS.get(key);
  if (!object) return problem(404, "not-found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  headers.set(SHA_HEADER, object.customMetadata?.sha256 ?? "");
  headers.set("Cache-Control", "no-store");
  return new Response(object.body, { headers });
}

async function authorized(header: string | null, expected: string | undefined): Promise<boolean> {
  if (!header?.startsWith("Bearer ") || !expected) return false;
  const [actual, wanted] = await Promise.all([sha256(header.slice("Bearer ".length)), sha256(expected)]);
  // Hash first so the comparison does not reveal the token's length.
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index]! ^ wanted[index]!;
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function isSafeKey(key: string | null): key is string {
  if (!key || key.length > MAX_KEY_LENGTH || key.startsWith("/") || key.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(key)) return false;
  return key.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function problem(status: number, code: string): Response {
  return json({ error: code }, status);
}
