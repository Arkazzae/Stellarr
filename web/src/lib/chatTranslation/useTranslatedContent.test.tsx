import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranslationTargetLanguage } from "@/i18n";

import type * as TranslateModule from "./translate";
import { TranslationCancelledError, translate } from "./translate";
import { useTranslatedContent } from "./useTranslatedContent";

vi.mock("./translate", async (importOriginal) => ({
  ...(await importOriginal<typeof TranslateModule>()),
  translate: vi.fn(),
}));

const translateMock = vi.mocked(translate);

interface Props {
  content: string;
  target?: TranslationTargetLanguage;
  trigger?: boolean;
  priority?: boolean;
  retryKey?: number;
}

function render(initial: Props) {
  return renderHook(
    ({ content, target = "en", ...options }: Props) =>
      useTranslatedContent(content, target, { trigger: true, ...options }),
    { initialProps: initial },
  );
}

describe("useTranslatedContent", () => {
  beforeEach(() => {
    translateMock.mockReset();
  });

  it("does nothing until it is triggered", async () => {
    const { result, rerender } = render({ content: "Dzień dobry", trigger: false });

    expect(result.current).toEqual({ translatedContent: null, loading: false, error: null });
    expect(translateMock).not.toHaveBeenCalled();

    translateMock.mockResolvedValue("Good morning");
    rerender({ content: "Dzień dobry", trigger: true });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.translatedContent).toBe("Good morning"));
    expect(result.current.loading).toBe(false);
  });

  it("never asks to translate blank content", () => {
    const { result } = render({ content: "  \n" });

    expect(result.current).toEqual({ translatedContent: null, loading: false, error: null });
    expect(translateMock).not.toHaveBeenCalled();
  });

  it("passes the language and priority on to translate", async () => {
    translateMock.mockResolvedValue("Dzień dobry");

    const { result } = render({ content: "Good morning", target: "pl", priority: true });

    await waitFor(() => expect(result.current.translatedContent).toBe("Dzień dobry"));
    expect(translateMock).toHaveBeenCalledWith("Good morning", "pl", { priority: true });
  });

  it("reports a failure and tries again when the retry key changes", async () => {
    translateMock.mockRejectedValueOnce(new Error("No model"));
    const { result, rerender } = render({ content: "Dzień dobry", retryKey: 0 });

    await waitFor(() => expect(result.current.error?.message).toBe("No model"));
    expect(result.current).toMatchObject({ translatedContent: null, loading: false });

    translateMock.mockResolvedValue("Good morning");
    rerender({ content: "Dzień dobry", retryKey: 1 });

    await waitFor(() => expect(result.current.translatedContent).toBe("Good morning"));
    expect(result.current.error).toBeNull();
  });

  it("does not treat cancelled work as an error", async () => {
    translateMock.mockRejectedValue(new TranslationCancelledError());

    const { result } = render({ content: "Dzień dobry" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ translatedContent: null, loading: false, error: null });
  });

  it("drops the previous translation as soon as the content changes", async () => {
    translateMock.mockResolvedValueOnce("Good morning");
    const { result, rerender } = render({ content: "Dzień dobry" });
    await waitFor(() => expect(result.current.translatedContent).toBe("Good morning"));

    translateMock.mockResolvedValueOnce("Good evening");
    rerender({ content: "Dobry wieczór" });

    expect(result.current).toEqual({ translatedContent: null, loading: true, error: null });
    await waitFor(() => expect(result.current.translatedContent).toBe("Good evening"));
  });

  it("ignores a late answer for content that has since changed", async () => {
    let answerOld: (translation: string) => void = () => {};
    translateMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerOld = resolve;
        }),
    );
    const { result, rerender } = render({ content: "Dzień dobry" });

    translateMock.mockResolvedValueOnce("Good evening");
    rerender({ content: "Dobry wieczór" });
    await waitFor(() => expect(result.current.translatedContent).toBe("Good evening"));
    answerOld("Good morning");
    await Promise.resolve();

    expect(result.current.translatedContent).toBe("Good evening");
  });
});
