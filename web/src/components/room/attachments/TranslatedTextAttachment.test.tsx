import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { translateMessage } from "@/i18n";

import { parseInline } from "../parts";
import { TranslatedTextAttachment } from "./TranslatedTextAttachment";

vi.mock("@/lib/chatTranslation/useTranslatedContent", () => ({
  useTranslatedContent: (
    _content: string,
    _target: string,
    options: { trigger: boolean },
  ) => ({
    translatedContent: options.trigger ? "Hello from Stellarr" : null,
    loading: false,
    error: null,
  }),
}));

describe("TranslatedTextAttachment", () => {
  it("translates on demand and keeps the original one click away", async () => {
    const user = userEvent.setup();
    render(
      <TranslatedTextAttachment
        nodes={parseInline("Cześć ze Stellarr")}
        translation={{
          locale: "en",
          enabled: true,
          autoTranslate: false,
          targetLanguage: "en",
          t: (key, values) => translateMessage("en", key, values),
        }}
      />,
    );

    expect(screen.getByText("Cześć ze Stellarr")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Translate" }));
    expect(screen.getByText("Hello from Stellarr")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByText("Cześć ze Stellarr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show translation" })).toBeInTheDocument();
  });
});
