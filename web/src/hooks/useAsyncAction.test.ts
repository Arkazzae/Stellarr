import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAsyncAction } from "./useAsyncAction";

describe("useAsyncAction", () => {
  it("is pending while the operation runs and settled afterwards", async () => {
    const { result } = renderHook(() => useAsyncAction());
    let finish: () => void = () => {};
    const operation = () => new Promise<void>((resolve) => (finish = resolve));

    let outcome: Promise<boolean> = Promise.resolve(false);
    act(() => {
      outcome = result.current.run(operation);
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      finish();
      await outcome;
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.failed).toBe(false);
    await expect(outcome).resolves.toBe(true);
  });

  it("reports a rejected operation instead of throwing", async () => {
    const { result } = renderHook(() => useAsyncAction());

    let completed = true;
    await act(async () => {
      completed = await result.current.run(() => Promise.reject(new Error("no")));
    });

    expect(completed).toBe(false);
    expect(result.current.failed).toBe(true);
    expect(result.current.pending).toBe(false);
  });

  it("catches an operation that throws before returning a promise", async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(() => {
        throw new Error("sync");
      });
    });

    expect(result.current.failed).toBe(true);
  });

  it("clears an earlier failure when the next operation starts", async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("no")));
    });
    expect(result.current.failed).toBe(true);

    await act(async () => {
      await result.current.run(() => Promise.resolve());
    });
    expect(result.current.failed).toBe(false);
  });
});
