import { useCallback, useEffect, useState } from "react";

export interface CockpitResource<T> {
  data: T | null;
  /** The message of the last failed read; cleared by the next successful one. */
  error: string | null;
  loading: boolean;
  /** Reads again. The previous data stays in place while loading and after a failure. */
  refresh: () => Promise<void>;
}

/**
 * Reads a resource when the page mounts and again on demand.
 * `load` must be a stable function, such as a method of `cockpitApi`.
 */
export function useCockpitResource<T>(
  load: (signal?: AbortSignal) => Promise<T>,
  failureMessage: string,
): CockpitResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const read = useCallback(
    (signal?: AbortSignal) =>
      load(signal).then(
        (result) => {
          if (signal?.aborted) return;
          setData(result);
          setError(null);
          setLoading(false);
        },
        (cause: unknown) => {
          if (signal?.aborted) return;
          setError(cause instanceof Error ? cause.message : failureMessage);
          setLoading(false);
        },
      ),
    [load, failureMessage],
  );

  useEffect(() => {
    // StrictMode mounts twice; the first read is aborted and must leave no trace.
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await read();
  }, [read]);

  return { data, error, loading, refresh };
}
