import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "@/components/primitives/Avatar";
import { Dropdown } from "@/components/primitives/Dropdown";
import { LoginScreen } from "@/components/login/LoginScreen";
import { translateMessage } from "@/i18n";
import { LanguageProvider } from "@/state/LanguageProvider";

/**
 * The suite starts every test on a Polish page. These tests are the English
 * one: a page the server rendered with `<html lang="en">`, where components
 * that were handed no translator still speak English.
 */
beforeEach(() => {
  document.documentElement.lang = "en";
});

describe("screens on an English page", () => {
  it("sign-in reads in English without a provider", () => {
    render(<LoginScreen onSubmit={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Username or email" })).toBeInTheDocument();
  });

  it("a dropdown with nothing chosen asks to choose", () => {
    render(<Dropdown options={[]} value="" onChange={vi.fn()} label="Role" />);

    expect(screen.getByText("Choose…")).toBeInTheDocument();
  });

  it("an avatar that opens a profile names it in English", () => {
    render(<Avatar id="u1" displayName="Ada" onOpen={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Profile: Ada" })).toBeInTheDocument();
  });

  it("the provider starts in English when the server chose nothing else", () => {
    render(
      <LanguageProvider>
        <Dropdown options={[]} value="" onChange={vi.fn()} label="Role" />
      </LanguageProvider>,
    );

    expect(screen.getByText("Choose…")).toBeInTheDocument();
  });
});

describe("the same screens for a person who chose Polish", () => {
  it("keep the Polish interface", () => {
    // The containers hand a screen the translator of the language the person chose.
    render(
      <LanguageProvider initialLocale="pl">
        <LoginScreen onSubmit={vi.fn()} t={(key, values) => translateMessage("pl", key, values)} />
        <Dropdown options={[]} value="" onChange={vi.fn()} label="Rola" />
      </LanguageProvider>,
    );

    expect(screen.getByRole("heading", { name: "Zaloguj się" })).toBeInTheDocument();
    expect(screen.getByText("Wybierz…")).toBeInTheDocument();
  });
});
