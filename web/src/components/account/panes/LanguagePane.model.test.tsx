import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage } from "@/i18n";
import type { ModelDownloadState } from "@/lib/chatTranslation/useModelStatus";

import { LanguagePane, type LanguagePaneProps } from "./LanguagePane";

const model = vi.hoisted(() => ({
  state: { status: "ready" } as ModelDownloadState,
  download: vi.fn(async () => undefined),
  check: vi.fn(async () => undefined),
}));

vi.mock("@/lib/chatTranslation/useModelStatus", () => ({
  useModelStatus: () => model,
}));

function setup(overrides: Partial<LanguagePaneProps> = {}) {
  const update = vi.fn();
  render(
    <LanguagePane
      locale="en"
      chatTranslationEnabled
      chatAutoTranslateEnabled={false}
      chatTranslationTargetLanguage="pl"
      update={update}
      t={(key, values) => translateMessage("en", key, values)}
      {...overrides}
    />,
  );
  return update;
}

describe("LanguagePane model states", () => {
  beforeEach(() => {
    model.state = { status: "ready" };
    model.download.mockClear();
  });

  it("hides the translation options while translation is off", async () => {
    const update = setup({ chatTranslationEnabled: false });

    expect(screen.queryByRole("button", { name: "Translate automatically" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Translation target language" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Enable translation" }));
    expect(update).toHaveBeenCalledWith({ chatTranslationEnabled: true });
    expect(model.download).not.toHaveBeenCalled();
  });

  it("picks the language messages are translated into", async () => {
    const update = setup();

    const groups = screen.getAllByRole("radiogroup");
    expect(groups).toHaveLength(2);
    const target = groups[1]!;
    await userEvent.click(
      target.querySelector<HTMLElement>('[role="radio"][aria-checked="false"]')!,
    );

    expect(update).toHaveBeenCalledWith({ chatTranslationTargetLanguage: "en" });
  });

  it("shows download progress", () => {
    model.state = { status: "downloading", progress: 40 };
    setup();

    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(document.querySelector("progress")).toHaveAttribute("value", "40");
  });

  it("offers a retry when the model failed to download", async () => {
    model.state = { status: "error", message: "offline" };
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(model.download).toHaveBeenCalledOnce();
  });

  it("says when the device cannot translate at all", () => {
    model.state = { status: "unavailable" };
    setup();

    expect(screen.getByRole("alert")).toHaveTextContent("This translation pair is unavailable.");
    expect(screen.getByRole("button", { name: "Translate automatically" })).toBeDisabled();
  });
});
