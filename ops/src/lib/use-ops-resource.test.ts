import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useOpsResource } from "./use-ops-resource";

type Load = (signal?: AbortSignal) => Promise<string>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useOpsResource", () => {
  it("starts loading and holds the data once the read succeeds", async () => {
    const read = deferred<string>();
    const load = vi.fn<Load>(() => read.promise);
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."));

    expect(result.current).toMatchObject({ data: null, error: null, loading: true });

    await act(async () => read.resolve("pierwsze"));

    expect(result.current).toMatchObject({ data: "pierwsze", error: null, loading: false });
  });

  it("reports the message of a failed read", async () => {
    const load = vi.fn<Load>().mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({ data: null, error: "Backend odpowiedział kodem 500." });
  });

  it("falls back to the given message when the failure is not an Error", async () => {
    const load = vi.fn<Load>().mockRejectedValue("boom");
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."));

    await waitFor(() => expect(result.current.error).toBe("Nie udało się."));
  });

  it("keeps the previous data while refreshing and after a failed refresh", async () => {
    const second = deferred<string>();
    const load = vi
      .fn<Load>()
      .mockResolvedValueOnce("pierwsze")
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."));
    await waitFor(() => expect(result.current.data).toBe("pierwsze"));

    let refreshed!: Promise<void>;
    act(() => {
      refreshed = result.current.refresh();
    });

    expect(result.current).toMatchObject({ data: "pierwsze", loading: true });

    await act(async () => {
      second.reject(new Error("Brak połączenia."));
      await refreshed;
    });

    expect(result.current).toMatchObject({ data: "pierwsze", error: "Brak połączenia.", loading: false });
  });

  it("replaces the data and clears the error after a successful refresh", async () => {
    const load = vi
      .fn<Load>()
      .mockRejectedValueOnce(new Error("Brak połączenia."))
      .mockResolvedValueOnce("drugie");
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."));
    await waitFor(() => expect(result.current.error).toBe("Brak połączenia."));

    await act(() => result.current.refresh());

    expect(result.current).toMatchObject({ data: "drugie", error: null, loading: false });
  });

  it("reads on mount with an abort signal but refreshes without one", async () => {
    const load = vi.fn<Load>().mockResolvedValue("dane");
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.refresh());

    expect(load.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(load.mock.calls[1]?.[0]).toBeUndefined();
  });

  it("aborts the first read when unmounted", () => {
    const load = vi.fn<Load>(() => new Promise<string>(() => {}));
    const { unmount } = renderHook(() => useOpsResource(load, "Nie udało się."));
    const signal = load.mock.calls[0]?.[0];

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("leaves no trace of the read that StrictMode aborts", async () => {
    const load = vi.fn<Load>(
      (signal) =>
        new Promise<string>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Przerwano.", "AbortError")));
        }),
    );
    const { result } = renderHook(() => useOpsResource(load, "Nie udało się."), { wrapper: StrictMode });

    // Let the aborted read settle; the second one is still pending.
    await act(async () => {});

    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: null, error: null, loading: true });
  });
});
