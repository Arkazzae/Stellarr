import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LanguageProvider,
  useLanguage,
  type LanguageSettings,
  type LanguageValue,
} from "./LanguageProvider";
import { useLanguage as useLanguageFromBarrel } from "./hooks";

const STORAGE_KEY = "stellarr_language_settings";

type Actions = Record<string, (language: LanguageValue) => void>;

/** Prints the current settings and offers one button per named action. */
function Probe({ actions = {} }: { actions?: Actions }) {
  const language = useLanguage();
  const { text, t } = language;
  const settings: LanguageSettings = {
    locale: language.locale,
    chatTranslationEnabled: language.chatTranslationEnabled,
    chatAutoTranslateEnabled: language.chatAutoTranslateEnabled,
    chatTranslationTargetLanguage: language.chatTranslationTargetLanguage,
  };
  return (
    <div>
      <output aria-label="settings">{JSON.stringify(settings)}</output>
      <output aria-label="text">{text("Cześć", "Hello")}</output>
      <output aria-label="message">{t("settings.language.title")}</output>
      {Object.entries(actions).map(([name, run]) => (
        <button key={name} type="button" onClick={() => run(language)}>
          {name}
        </button>
      ))}
    </div>
  );
}

/** The provider reads device preferences in an animation frame after mounting. */
async function hydrated() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function shownSettings() {
  return JSON.parse(screen.getByLabelText("settings").textContent ?? "{}") as Record<
    string,
    unknown
  >;
}

function storedSettings() {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
}

describe("useLanguage without a provider", () => {
  it("reads as Polish and ignores updates", async () => {
    const user = userEvent.setup();
    render(<Probe actions={{ switch: (language) => language.update({ locale: "en" }) }} />);

    await user.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByLabelText("text")).toHaveTextContent("Cześć");
    expect(screen.getByLabelText("message")).toHaveTextContent("Język");
    expect(shownSettings()).toMatchObject({ locale: "pl", chatTranslationEnabled: false });
  });

  it("is the same hook the state barrel exports", () => {
    expect(useLanguageFromBarrel).toBe(useLanguage);
  });
});

describe("LanguageProvider settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = "stellarr_locale=; path=/; max-age=0";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows English copy for both lookups once the locale is English", () => {
    render(
      <LanguageProvider initialLocale="en">
        <Probe />
      </LanguageProvider>,
    );

    expect(screen.getByLabelText("text")).toHaveTextContent("Hello");
    expect(screen.getByLabelText("message")).toHaveTextContent("Language");
    expect(document.documentElement.dataset.locale).toBe("en");
  });

  it("leaves the cookie alone when the stored locale matches the server's", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ locale: "pl", chatTranslationEnabled: true }),
    );
    render(
      <LanguageProvider initialLocale="pl">
        <Probe />
      </LanguageProvider>,
    );

    await hydrated();

    expect(shownSettings()).toMatchObject({ locale: "pl", chatTranslationEnabled: true });
    expect(document.cookie).not.toContain("stellarr_locale");
  });

  it("does not keep auto-translation from a device where translation is off", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        locale: "en",
        chatTranslationEnabled: false,
        chatAutoTranslateEnabled: true,
        chatTranslationTargetLanguage: "pl",
      }),
    );
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    await hydrated();

    expect(shownSettings()).toMatchObject({
      locale: "en",
      chatTranslationEnabled: false,
      chatAutoTranslateEnabled: false,
      chatTranslationTargetLanguage: "pl",
    });
  });

  it.each([
    ["unparseable text", "{not json"],
    ["null", "null"],
    ["unsupported values", JSON.stringify({ locale: "de", chatTranslationTargetLanguage: "fr" })],
  ])("falls back to defaults for %s in storage", async (_name, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    render(
      <LanguageProvider initialLocale="en">
        <Probe />
      </LanguageProvider>,
    );

    await hydrated();

    expect(shownSettings()).toEqual({
      locale: "en",
      chatTranslationEnabled: false,
      chatAutoTranslateEnabled: false,
      chatTranslationTargetLanguage: "en",
    });
  });

  it("turns auto-translation off along with translation", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe
          actions={{
            enable: (language) =>
              language.update({ chatTranslationEnabled: true, chatAutoTranslateEnabled: true }),
            disable: (language) => language.update({ chatTranslationEnabled: false }),
          }}
        />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "enable" }));
    expect(shownSettings()).toMatchObject({ chatAutoTranslateEnabled: true });

    await user.click(screen.getByRole("button", { name: "disable" }));
    expect(shownSettings()).toMatchObject({
      chatTranslationEnabled: false,
      chatAutoTranslateEnabled: false,
    });
    expect(storedSettings()).toMatchObject({ chatAutoTranslateEnabled: false });
  });

  it("names the chosen language only once the person has chosen one", async () => {
    const user = userEvent.setup();
    const seen: (string | undefined)[] = [];
    render(
      <LanguageProvider initialLocale="pl">
        <Probe
          actions={{
            check: (language) => seen.push(language.chosenLocale()),
            english: (language) => language.update({ locale: "en" }),
            translate: (language) => language.update({ chatTranslationEnabled: true }),
          }}
        />
      </LanguageProvider>,
    );
    await hydrated();

    await user.click(screen.getByRole("button", { name: "translate" }));
    await user.click(screen.getByRole("button", { name: "check" }));
    await user.click(screen.getByRole("button", { name: "english" }));
    await user.click(screen.getByRole("button", { name: "check" }));

    // The instance default showing is not a choice; picking one is.
    expect(seen).toEqual([undefined, "en"]);
  });

  it("applies several updates made in the same tick", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe
          actions={{
            both: (language) => {
              language.update({ chatTranslationEnabled: true });
              language.update({ chatAutoTranslateEnabled: true });
            },
          }}
        />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "both" }));

    expect(shownSettings()).toMatchObject({
      chatTranslationEnabled: true,
      chatAutoTranslateEnabled: true,
    });
    expect(storedSettings()).toMatchObject({
      chatTranslationEnabled: true,
      chatAutoTranslateEnabled: true,
    });
  });

  it("keeps auto-translation when the target language is set to what it already is", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe
          actions={{
            enable: (language) =>
              language.update({ chatTranslationEnabled: true, chatAutoTranslateEnabled: true }),
            same: (language) =>
              language.update({
                chatTranslationTargetLanguage: language.chatTranslationTargetLanguage,
              }),
          }}
        />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "enable" }));
    await user.click(screen.getByRole("button", { name: "same" }));

    expect(shownSettings()).toMatchObject({ chatAutoTranslateEnabled: true });
  });

  it("applies a change even when the browser refuses storage", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe actions={{ english: (language) => language.update({ locale: "en" }) }} />
      </LanguageProvider>,
    );
    // With nothing stored, a hydration frame that lands after the click would
    // read the defaults and replace the change.
    await hydrated();

    await user.click(screen.getByRole("button", { name: "english" }));

    expect(setItem).toHaveBeenCalled();
    expect(shownSettings()).toMatchObject({ locale: "en" });
    expect(document.cookie).toContain("stellarr_locale=en");
  });

  it("does not write a cookie for an update that keeps the locale", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <Probe actions={{ enable: (language) => language.update({ chatTranslationEnabled: true }) }} />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "enable" }));

    expect(document.cookie).not.toContain("stellarr_locale");
  });
});
