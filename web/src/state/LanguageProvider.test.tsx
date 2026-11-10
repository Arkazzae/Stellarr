import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider, useLanguage } from "./LanguageProvider";

function Probe() {
  const language = useLanguage();
  return (
    <div>
      <output aria-label="locale">{language.locale}</output>
      <output aria-label="title">{language.t("settings.language.title")}</output>
      <output aria-label="auto">{String(language.chatAutoTranslateEnabled)}</output>
      <button type="button" onClick={() => language.update({ locale: "en" })}>
        English
      </button>
      <button
        type="button"
        onClick={() =>
          language.update({
            chatTranslationEnabled: true,
            chatAutoTranslateEnabled: true,
          })
        }
      >
        Enable auto
      </button>
      <button
        type="button"
        onClick={() => language.update({ chatTranslationTargetLanguage: "pl" })}
      >
        Target Polish
      </button>
    </div>
  );
}

describe("LanguageProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "stellarr_locale=; path=/; max-age=0";
    document.documentElement.lang = "pl";
  });

  it("uses the server locale immediately and persists a new selection", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLocale="pl">
        <Probe />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByLabelText("locale")).toHaveTextContent("en");
    expect(screen.getByLabelText("title")).toHaveTextContent("Language");
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.cookie).toContain("stellarr_locale=en");
    expect(JSON.parse(window.localStorage.getItem("stellarr_language_settings") ?? "{}"))
      .toMatchObject({ locale: "en" });
  });

  it("hydrates device preferences and pauses auto-translation for a new pair", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "stellarr_language_settings",
      JSON.stringify({
        locale: "en",
        chatTranslationEnabled: true,
        chatAutoTranslateEnabled: true,
        chatTranslationTargetLanguage: "en",
      }),
    );

    render(
      <LanguageProvider initialLocale="pl">
        <Probe />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("locale")).toHaveTextContent("en"));
    expect(document.cookie).toContain("stellarr_locale=en");
    expect(screen.getByLabelText("auto")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "Target Polish" }));
    expect(screen.getByLabelText("auto")).toHaveTextContent("false");
  });
});
