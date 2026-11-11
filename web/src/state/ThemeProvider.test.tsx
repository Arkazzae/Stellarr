import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/design/themes";
import { ThemeProvider, useTheme } from "@/state/ThemeProvider";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Replaces `matchMedia` with a colour-scheme preference a test can flip. */
function controlColorScheme(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        get matches() {
          return query === DARK_QUERY && dark;
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return (nextDark: boolean) => {
    dark = nextDark;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function Probe() {
  const { theme, resolved, update, reset } = useTheme();
  return (
    <>
      <output aria-label="theme">{JSON.stringify(theme)}</output>
      <output aria-label="resolved">{resolved}</output>
      <button onClick={() => update({ palette: "evergreen", accent: "#1db954" })}>
        evergreen
      </button>
      <button onClick={() => update({ density: "compact" })}>compact</button>
      <button onClick={() => update({ scheme: "system" })}>follow system</button>
      <button onClick={reset}>reset</button>
    </>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

function shownTheme() {
  return JSON.parse(screen.getByLabelText("theme").textContent ?? "");
}

function storedTheme() {
  return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null");
}

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  root.removeAttribute("style");
  for (const attribute of [...root.attributes]) {
    if (attribute.name.startsWith("data-")) root.removeAttribute(attribute.name);
  }
});

describe("ThemeProvider", () => {
  it("starts from the default theme when nothing is stored", () => {
    renderProvider();

    expect(shownTheme()).toEqual(DEFAULT_THEME);
    expect(root.dataset.theme).toBe("midnight");
    expect(root.dataset.scheme).toBe("dark");
    expect(root.dataset.font).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("restores a stored preference, migrating ids from older versions", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ palette: "github", scheme: "light", font: "mono" }),
    );

    renderProvider();

    expect(shownTheme()).toMatchObject({
      palette: "ink",
      scheme: "light",
    });
    expect(shownTheme()).not.toHaveProperty("font");
    expect(root.dataset.theme).toBe("ink");
    expect(root.dataset.scheme).toBe("light");
    expect(root.dataset.font).toBeUndefined();
    expect(root.style.getPropertyValue("--palette-accent")).toBe("#58a6ff");
  });

  it("falls back to the default theme when the stored value is not JSON", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "{not json");

    renderProvider();

    expect(shownTheme()).toEqual(DEFAULT_THEME);
  });

  it("applies an update to <html> and stores every axis under one key", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByRole("button", { name: "evergreen" }));
    await user.click(screen.getByRole("button", { name: "compact" }));

    const expected = {
      ...DEFAULT_THEME,
      palette: "evergreen",
      accent: "#1db954",
      density: "compact",
    };
    expect(shownTheme()).toEqual(expected);
    expect(storedTheme()).toEqual(expected);
    expect(root.dataset.theme).toBe("evergreen");
    expect(root.dataset.density).toBe("compact");
    expect(root.style.getPropertyValue("--palette-accent")).toBe("#1db954");
    expect(root.style.getPropertyValue("--palette-background-primary")).toBe(
      "#1a1a1a",
    );
  });

  it("keeps a stored preference for the next visit", async () => {
    const user = userEvent.setup();
    const first = renderProvider();
    await user.click(screen.getByRole("button", { name: "compact" }));
    first.unmount();

    renderProvider();

    expect(shownTheme().density).toBe("compact");
  });

  it("resets every axis with a single write", async () => {
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByRole("button", { name: "evergreen" }));
    const setItem = vi.spyOn(localStorage, "setItem");

    await user.click(screen.getByRole("button", { name: "reset" }));

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(storedTheme()).toEqual(DEFAULT_THEME);
    expect(root.dataset.theme).toBe("midnight");
  });

  it("still changes the theme for the session when storage refuses writes", async () => {
    const user = userEvent.setup();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "QuotaExceededError");
    });
    renderProvider();

    await user.click(screen.getByRole("button", { name: "compact" }));

    expect(shownTheme().density).toBe("compact");
    expect(root.dataset.density).toBe("compact");
  });

  it("follows the system colour scheme while the preference is system", async () => {
    const user = userEvent.setup();
    const setSystemDark = controlColorScheme(true);
    renderProvider();

    await user.click(screen.getByRole("button", { name: "follow system" }));
    expect(screen.getByLabelText("resolved")).toHaveTextContent("dark");
    expect(root.dataset.scheme).toBe("dark");

    setSystemDark(false);
    expect(screen.getByLabelText("resolved")).toHaveTextContent("light");
    expect(root.dataset.scheme).toBe("light");
    expect(shownTheme().scheme).toBe("system");
    expect(storedTheme().scheme).toBe("system");

    setSystemDark(true);
    expect(root.dataset.scheme).toBe("dark");
  });

  it("ignores the system colour scheme for an explicit choice", () => {
    const setSystemDark = controlColorScheme(true);
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_THEME, scheme: "dark" }),
    );
    renderProvider();

    setSystemDark(false);

    expect(root.dataset.scheme).toBe("dark");
  });

  it("refuses to be used outside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/inside <ThemeProvider>/);
  });
});
