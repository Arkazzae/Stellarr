import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAutostartStatus, DesktopPort } from "@/ports";

import { useAutostart } from "./useAutostart";

function desktop(overrides: Partial<DesktopPort> = {}): DesktopPort {
  return {
    getAutostart: vi.fn(async () => ({ available: true, enabled: false })),
    setAutostart: vi.fn(async (enabled) => ({ available: true, enabled })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAutostart", () => {
  it("is unavailable without a desktop client", () => {
    const { result } = renderHook(() => useAutostart(undefined));

    expect(result.current.autostart).toEqual({
      available: false,
      enabled: false,
      pending: false,
      error: false,
    });
  });

  it("reads the system setting once the client answers", async () => {
    const port = desktop({
      getAutostart: vi.fn(async () => ({ available: true, enabled: true })),
    });
    const { result } = renderHook(() => useAutostart(port));
    expect(result.current.autostart.pending).toBe(true);

    await waitFor(() => expect(result.current.autostart.pending).toBe(false));

    expect(result.current.autostart).toEqual({
      available: true,
      enabled: true,
      pending: false,
      error: false,
    });
  });

  it("reports a setting it could not read", async () => {
    const port = desktop({
      getAutostart: vi.fn(async () => {
        throw new Error("no registry");
      }),
    });
    const { result } = renderHook(() => useAutostart(port));

    await waitFor(() => expect(result.current.autostart.error).toBe(true));

    expect(result.current.autostart.pending).toBe(false);
  });

  it("shows a change at once and keeps what the system confirms", async () => {
    let confirm: (status: DesktopAutostartStatus) => void = () => undefined;
    const port = desktop({
      setAutostart: vi.fn(
        () =>
          new Promise<DesktopAutostartStatus>((done) => {
            confirm = done;
          }),
      ),
    });
    const { result } = renderHook(() => useAutostart(port));
    await waitFor(() => expect(result.current.autostart.pending).toBe(false));

    act(() => result.current.setEnabled(true));
    expect(result.current.autostart).toMatchObject({ enabled: true, pending: true });

    await act(async () => confirm({ available: true, enabled: true }));
    expect(result.current.autostart).toEqual({
      available: true,
      enabled: true,
      pending: false,
      error: false,
    });
    expect(port.setAutostart).toHaveBeenCalledWith(true);
  });

  it("takes the change back when the system refuses it", async () => {
    const port = desktop({
      setAutostart: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    const { result } = renderHook(() => useAutostart(port));
    await waitFor(() => expect(result.current.autostart.pending).toBe(false));

    act(() => result.current.setEnabled(true));

    await waitFor(() => expect(result.current.autostart.error).toBe(true));
    expect(result.current.autostart).toMatchObject({ enabled: false, pending: false });
  });

  it("ignores another change while one is outstanding", async () => {
    const port = desktop({
      setAutostart: vi.fn(() => new Promise<DesktopAutostartStatus>(() => undefined)),
    });
    const { result } = renderHook(() => useAutostart(port));
    await waitFor(() => expect(result.current.autostart.pending).toBe(false));

    act(() => result.current.setEnabled(true));
    act(() => result.current.setEnabled(false));

    expect(port.setAutostart).toHaveBeenCalledOnce();
    expect(result.current.autostart.enabled).toBe(true);
  });

  it("does nothing to change without a desktop client", () => {
    const { result } = renderHook(() => useAutostart(undefined));

    act(() => result.current.setEnabled(true));

    expect(result.current.autostart.enabled).toBe(false);
  });
});
