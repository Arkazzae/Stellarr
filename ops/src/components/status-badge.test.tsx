import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/status-badge";

describe("StatusBadge", () => {
  it.each([
    ["healthy", "Działa"],
    ["warning", "Wymaga uwagi"],
    ["error", "Błąd"],
    ["inactive", "Nieaktywne"],
  ] as const)("labels the %s state", (state, label) => {
    render(<StatusBadge state={state} />);

    expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows the given label in place of the default one", () => {
    render(<StatusBadge state="healthy" label="Połączono" />);

    expect(screen.getByText("Połączono")).toBeTruthy();
    expect(screen.queryByText("Działa")).toBeNull();
  });
});
