import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranslationTargetLanguage } from "@/i18n";

import { downloadModel, getModelStatus, getPairSize } from "./modelStatus";
import { useModelStatus } from "./useModelStatus";

vi.mock("./modelStatus", () => ({
  getModelStatus: vi.fn(),
  getPairSize: vi.fn(),
  downloadModel: vi.fn(),
}));

const status = vi.mocked(getModelStatus);
const size = vi.mocked(getPairSize);
const download = vi.mocked(downloadModel);

describe("useModelStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    size.mockResolvedValue(22.2 * 1024 * 1024);
  });

  it("reports a model that is already on the device", async () => {
    status.mockResolvedValue("ready");

    const { result } = renderHook(() => useModelStatus("en", true));

    expect(result.current.state).toEqual({ status: "checking" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready" }));
    expect(size).not.toHaveBeenCalled();
  });

  it("rounds the size of a missing model up to whole megabytes", async () => {
    status.mockResolvedValue("not-downloaded");

    const { result } = renderHook(() => useModelStatus("en", true));

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "not-downloaded", sizeMb: 23 }),
    );
  });

  it("does not look anything up while translation is disabled", async () => {
    const { result } = renderHook(() => useModelStatus("en", false));

    await act(async () => {});

    expect(status).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "checking" });
  });

  it("leaves a check requested while translation is disabled at checking", async () => {
    const { result } = renderHook(() => useModelStatus("en", false));

    await act(() => result.current.check());

    expect(status).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "checking" });
  });

  it("shows download progress and ends ready", async () => {
    status.mockResolvedValue("not-downloaded");
    let finish: () => void = () => {};
    download.mockImplementation(async (_target, onProgress) => {
      onProgress?.(40);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const { result } = renderHook(() => useModelStatus("pl", true));
    await waitFor(() => expect(result.current.state.status).toBe("not-downloaded"));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.download();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "downloading", progress: 40 }),
    );
    expect(download).toHaveBeenCalledWith("pl", expect.any(Function));

    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.state).toEqual({ status: "ready" });
  });

  it("turns a failed download into an error that a re-check clears", async () => {
    status.mockResolvedValue("not-downloaded");
    download.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useModelStatus("en", true));
    await waitFor(() => expect(result.current.state.status).toBe("not-downloaded"));

    await act(() => result.current.download());
    expect(result.current.state).toEqual({ status: "error", message: "offline" });

    status.mockResolvedValue("ready");
    await act(() => result.current.check());
    expect(result.current.state).toEqual({ status: "ready" });
  });

  it("ignores an answer for a language that is no longer selected", async () => {
    let answerPolish: (value: "ready") => void = () => {};
    status.mockImplementation((target) =>
      target === "pl"
        ? new Promise((resolve) => {
            answerPolish = resolve;
          })
        : Promise.resolve("unavailable"),
    );
    const { result, rerender } = renderHook(
      ({ target }: { target: TranslationTargetLanguage }) => useModelStatus(target, true),
      { initialProps: { target: "pl" } },
    );

    rerender({ target: "en" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "unavailable" }));
    await act(async () => answerPolish("ready"));

    expect(result.current.state).toEqual({ status: "unavailable" });
  });
});
