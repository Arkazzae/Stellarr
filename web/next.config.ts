import path from "node:path";

import type { NextConfig } from "next";

const apiOrigin = process.env.STELLARR_API_ORIGIN ?? "http://127.0.0.1:5000";

function commaSeparated(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Next 16 rejects its own dev chunks when the page is opened from a host other
 * than `localhost`, which leaves only the server-rendered skeleton. Loopback
 * addresses must keep working, and IDE or remote previews are added by name.
 */
const allowedDevOrigins = [
  ...new Set(["127.0.0.1", ...commaSeparated(process.env.STELLARR_ALLOWED_DEV_ORIGINS)]),
];

/**
 * `web/` is a workspace of the repository root, which holds the hoisted
 * `node_modules` and the shared `packages/`. File tracing and Turbopack must
 * start there, or the standalone output misses the hoisted dependencies and the
 * shared package. The output then nests the app as `web/server.js`.
 */
const workspaceRoot = path.resolve(import.meta.dirname, "..");

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE_HOURLY = "public, max-age=3600, must-revalidate";

function cacheControl(source: string, value: string) {
  return { source, headers: [{ key: "Cache-Control", value }] };
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  // @stellarr/ui is consumed as TypeScript source, with no build step.
  transpilePackages: ["@stellarr/ui"],
  allowedDevOrigins,
  experimental: {
    // Dev rewrites buffer uploads in the Next server. 128 MB is the transport
    // ceiling of Kestrel and Nginx, so a video within the API's own 100 MB
    // media limit still arrives as one complete multipart request.
    proxyClientMaxBodySize: "128mb",
  },
  async redirects() {
    return [
      { source: "/rejestracja", destination: "/register", permanent: true },
      { source: "/zapomniane-haslo", destination: "/forgot-password", permanent: true },
      { source: "/reset-hasla", destination: "/reset-password", permanent: true },
    ];
  },
  /**
   * `next dev` serves the UI on :3000 and the API runs on :5000, so the
   * same-origin paths the client uses in production are proxied here. Nginx
   * does that in production, where this returns nothing.
   */
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/.well-known/stellarr/client",
        destination: `${apiOrigin}/.well-known/stellarr/client`,
      },
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/assets/:path*", destination: `${apiOrigin}/assets/:path*` },
      { source: "/hubs/:path*", destination: `${apiOrigin}/hubs/:path*` },
      {
        source: "/bergamot-models-gcs/:path*",
        destination: "https://storage.googleapis.com/bergamot-models-sandbox/0.3.3/:path*",
      },
    ];
  },
  async headers() {
    return [
      // Self-hosted fonts and the translation codecs never change in place.
      cacheControl("/fonts/:path*", IMMUTABLE),
      cacheControl("/codecs/bergamot/:path*", IMMUTABLE),
      // These URLs are stable but their content can change with a deploy.
      cacheControl("/bergamot-worker.js", REVALIDATE_HOURLY),
      cacheControl("/bergamot-models/registry.json", REVALIDATE_HOURLY),
    ];
  },
};

export default nextConfig;
