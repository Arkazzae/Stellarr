export type HealthCheckState = "checking" | "healthy" | "unavailable";

export interface HealthSnapshot {
  api: HealthCheckState;
  database: HealthCheckState;
  checkedAt: Date;
}

async function probe(path: string, signal?: AbortSignal): Promise<"healthy" | "unavailable"> {
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" }, signal });
    return response.ok ? "healthy" : "unavailable";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return "unavailable";
  }
}

/** Probes the liveness (api) and readiness (database) endpoints in parallel. */
export async function readHealth(signal?: AbortSignal): Promise<HealthSnapshot> {
  const [api, database] = await Promise.all([
    probe("/health/live", signal),
    probe("/health/ready", signal),
  ]);
  return { api, database, checkedAt: new Date() };
}
