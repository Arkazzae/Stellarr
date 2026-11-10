import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LanguageValue } from "@/state/hooks";
import { fakeLanguage } from "@/test/roomFakes";

import { useChatTranslation } from "./useChatTranslation";

const mocks = vi.hoisted(() => ({
  language: null as unknown as LanguageValue,
  cancelPending: vi.fn(),
}));

vi.mock("@/state/hooks", () => ({ useLanguage: () => mocks.language }));
vi.mock("@/lib/chatTranslation/translate", () => ({
  cancelPending: mocks.cancelPending,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = fakeLanguage();
});

describe("useChatTranslation", () => {
  it("reads the language settings as the transcript's translation options", () => {
    mocks.language = fakeLanguage({
      chatTranslationEnabled: true,
      chatAutoTranslateEnabled: true,
      chatTranslationTargetLanguage: "pl",
    });

    const { result } = renderHook(() => useChatTranslation("ch-1"));

    expect(result.current).toEqual({
      locale: "pl",
      enabled: true,
      autoTranslate: true,
      targetLanguage: "pl",
      t: mocks.language.t,
    });
  });

  it("keeps the same options object until a setting changes", () => {
    const { result, rerender } = renderHook(() => useChatTranslation("ch-1"));
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);

    mocks.language = fakeLanguage({ chatTranslationEnabled: true });
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.enabled).toBe(true);
  });

  it("drops queued translations when the conversation changes or the room closes", () => {
    const { rerender, unmount } = renderHook(
      ({ id }) => useChatTranslation(id),
      { initialProps: { id: "ch-1" } },
    );
    expect(mocks.cancelPending).not.toHaveBeenCalled();

    rerender({ id: "ch-1" });
    expect(mocks.cancelPending).not.toHaveBeenCalled();

    rerender({ id: "ch-2" });
    expect(mocks.cancelPending).toHaveBeenCalledTimes(1);

    unmount();
    expect(mocks.cancelPending).toHaveBeenCalledTimes(2);
  });
});
