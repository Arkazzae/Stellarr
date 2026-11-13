import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dropdown } from "./Dropdown";

describe("Dropdown", () => {
  it("asks to choose in the app's language when the value names nothing", () => {
    render(<Dropdown options={[]} value="" onChange={() => {}} label="Rola" />);

    expect(screen.getByRole("combobox", { name: "Rola" })).toHaveTextContent("Wybierz…");
  });

  it("shows the placeholder it is given instead", () => {
    render(
      <Dropdown options={[]} value="" onChange={() => {}} label="Rola" placeholder="Urządzenie niedostępne" />,
    );

    expect(screen.getByRole("combobox", { name: "Rola" })).toHaveTextContent("Urządzenie niedostępne");
  });
});
