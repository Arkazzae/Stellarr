export interface ClientRelease {
  version: string;
  publishedAt: string;
  notes: string;
  platform: "android" | "arch";
  architecture: "arm64-v8a" | "x86_64";
  fileName: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
}

export type DesktopRelease = ClientRelease & {
  platform: "arch";
  architecture: "x86_64";
};

function fetchJson(path: string, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
}

/** Every native client this instance publishes. */
export async function getClientReleases(signal?: AbortSignal): Promise<ClientRelease[]> {
  const response = await fetchJson("/api/client/releases", signal);
  if (!response.ok) {
    throw new Error(`Client releases request failed with ${response.status}.`);
  }
  return (await response.json()) as ClientRelease[];
}

/** The desktop build for the browser's download pane, or `null` when none is published. */
export async function getDesktopRelease(
  signal?: AbortSignal,
): Promise<DesktopRelease | null> {
  const response = await fetchJson("/api/desktop/release", signal);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Desktop release request failed with ${response.status}.`);
  }
  return (await response.json()) as DesktopRelease;
}
