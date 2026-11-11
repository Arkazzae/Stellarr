import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { NotFoundPage } from "@/pages/not-found-page";
import { selectPolish } from "@/test/locale";

selectPolish();

describe("NotFoundPage", () => {
  it("leads back to the overview", async () => {
    render(
      <MemoryRouter initialEntries={["/nie-ma-takiego-adresu"]}>
        <Routes>
          <Route path="/" element={<p>Przegląd</p>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Nie ma takiego widoku" })).toBeTruthy();

    await userEvent.click(screen.getByRole("link", { name: "Wróć do przeglądu" }));

    expect(screen.getByText("Przegląd")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Nie ma takiego widoku" })).toBeNull();
  });
});
