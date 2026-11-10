import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage } from "@/i18n";

import { LanguagePane } from "./LanguagePane";

const model = vi.hoisted(() => ({
  state: { status: "not-downloaded", sizeMb: 22 },
  download: vi.fn(async () => undefined),
  check: vi.fn(async () => undefined),
}));

vi.mock("@/lib/chatTranslation/useModelStatus", () => ({
  useModelStatus: () => model,
}));

describe("LanguagePane", () => {
  beforeEach(() => {
    model.state = { status: "not-downloaded", sizeMb: 22 };
    model.download.mockClear();
    model.check.mockClear();
  });

  it("downloads a missing model after translation is enabled", async () => {
    const update = vi.fn();
    render(
      <LanguagePane
        locale="pl"
        chatTranslationEnabled
        chatAutoTranslateEnabled={false}
        chatTranslationTargetLanguage="en"
        update={update}
        t={(key, values) => translateMessage("pl", key, values)}
      />,
    );

    await waitFor(() => expect(model.download).toHaveBeenCalledOnce());
    expect(screen.getByText(/22 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tłumacz automatycznie" }))
      .toBeDisabled();

    await userEvent.click(screen.getAllByRole("radio", { name: /English/ })[0]!);
    expect(update).toHaveBeenCalledWith({ locale: "en" });
  });

  it("allows auto-translation only after the model is ready", async () => {
    const update = vi.fn();
    model.state = { status: "ready", sizeMb: 22 };
    render(
      <LanguagePane
        locale="en"
        chatTranslationEnabled
        chatAutoTranslateEnabled={false}
        chatTranslationTargetLanguage="en"
        update={update}
        t={(key, values) => translateMessage("en", key, values)}
      />,
    );

    const auto = screen.getByRole("button", { name: "Translate automatically" });
    expect(auto).toBeEnabled();
    await userEvent.click(auto);
    expect(update).toHaveBeenCalledWith({ chatAutoTranslateEnabled: true });
  });
});
