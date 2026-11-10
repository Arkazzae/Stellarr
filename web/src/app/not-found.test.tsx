import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LanguageProvider } from "@/state/LanguageProvider";

import NotFound from "./not-found";

describe("the page for an address that leads nowhere", () => {
  it("speaks the language the provider holds", () => {
    const { unmount } = render(
      <LanguageProvider initialLocale="en">
        <NotFound />
      </LanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: /This page does not exist/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the conversation" })).toHaveAttribute(
      "href",
      "/",
    );
    unmount();

    render(
      <LanguageProvider initialLocale="pl">
        <NotFound />
      </LanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: /Taka strona nie istnieje/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do rozmowy" })).toBeInTheDocument();
  });
});
