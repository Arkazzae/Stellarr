import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageProvider, useLanguage } from "./LanguageProvider";

const STORAGE_KEY = "stellarr_language_settings";

function Probe() {
  const { locale, t, text, update } = useLanguage();
  return (
    <div>
      <output aria-label="locale">{locale}</output>
      <output aria-label="title">{t("settings.language.title")}</output>
      <output aria-label="text">{text("Cześć", "Hello")}</output>
      <button type="button" onClick={() => update({ chatTranslationEnabled: true })}>
        Translate chat
      </button>
      <button type="button" onClick={() => update({ locale })}>
        Keep this language
      </button>
    </div>
  );
}

/** The provider reads device preferences in an animation frame after mounting. */
async function hydrated() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function storedSettings(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
}

describe("the language before anyone chose one", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "stellarr_locale=; path=/; max-age=0";
  });

  it("reads a component rendered without a provider in the page's language", () => {
    document.documentElement.lang = "en";
    render(<Probe />);

    expect(screen.getByLabelText("locale")).toHaveTextContent("en");
    expect(screen.getByLabelText("title")).toHaveTextContent("Language");
    expect(screen.getByLabelText("text")).toHaveTextContent("Hello");
  });

  it("starts the provider in the page's language when the server gave none", () => {
    document.documentElement.lang = "en";
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByLabelText("locale")).toHaveTextContent("en");
    expect(screen.getByLabelText("title")).toHaveTextContent("Language");
  });

  it("prefers the server's locale over the page's", () => {
    document.documentElement.lang = "en";
    render(
      <LanguageProvider initialLocale="pl">
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByLabelText("locale")).toHaveTextContent("pl");
    expect(screen.getByLabelText("title")).toHaveTextContent("Język");
  });

  it("writes the language it shows onto the page, where unprovided code reads it", async () => {
    document.documentElement.lang = "";
    render(
      <LanguageProvider initialLocale="pl">
        <Probe />
      </LanguageProvider>,
    );
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(document.documentElement.lang).toBe("pl");
  });

  describe("when another setting changes", () => {
    it("does not store the instance default as the person's choice", async () => {
      const user = userEvent.setup();
      const first = render(
        <LanguageProvider initialLocale="pl">
          <Probe />
        </LanguageProvider>,
      );
      await hydrated();

      await user.click(screen.getByRole("button", { name: "Translate chat" }));
      expect(storedSettings()).toMatchObject({ chatTranslationEnabled: true });
      expect(storedSettings()).not.toHaveProperty("locale");
      first.unmount();

      // The operator has since changed the instance default.
      render(
        <LanguageProvider initialLocale="en">
          <Probe />
        </LanguageProvider>,
      );
      await hydrated();

      expect(screen.getByLabelText("locale")).toHaveTextContent("en");
    });

    it("keeps the language the person chose earlier, even before the stored settings load", async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ locale: "en", chatTranslationEnabled: false }),
      );
      const user = userEvent.setup();
      render(
        <LanguageProvider initialLocale="pl">
          <Probe />
        </LanguageProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Translate chat" }));
      expect(storedSettings()).toMatchObject({ locale: "en", chatTranslationEnabled: true });

      await hydrated();
      expect(screen.getByLabelText("locale")).toHaveTextContent("en");
    });
  });

  it("stores a language the person picks even when it is the instance default", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLocale="pl">
        <Probe />
      </LanguageProvider>,
    );
    await hydrated();

    await user.click(screen.getByRole("button", { name: "Keep this language" }));

    expect(storedSettings()).toMatchObject({ locale: "pl" });
  });
});
