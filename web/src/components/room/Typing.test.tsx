import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Typing } from "./Typing";

describe("Typing", () => {
  it("says nothing when nobody is typing", () => {
    const { container } = render(<Typing names={[]} />);
    expect(container.textContent).toBe("");
  });

  it("names one person with a singular verb", () => {
    render(<Typing names={["Nils"]} />);
    expect(screen.getByText("Nils pisze…")).toBeInTheDocument();
  });

  it("joins two people with 'i'", () => {
    render(<Typing names={["Nils", "Ada"]} />);
    expect(screen.getByText("Nils i Ada piszą…")).toBeInTheDocument();
  });

  it("separates three or more with commas and joins the last with 'i'", () => {
    render(<Typing names={["Nils", "Ada", "Bo", "Cy"]} />);
    expect(screen.getByText("Nils, Ada, Bo i Cy piszą…")).toBeInTheDocument();
  });

  it("keeps the same row as people start and stop typing", () => {
    const { container, rerender } = render(<Typing names={[]} />);
    const row = container.firstElementChild;

    rerender(<Typing names={["Nils"]} />);
    expect(container.firstElementChild).toBe(row);
    expect(row).toHaveTextContent("Nils pisze…");

    rerender(<Typing names={[]} />);
    expect(container.firstElementChild).toBe(row);
    expect(row?.textContent).toBe("");
  });

  it("does not change the names it was given", () => {
    const names = ["Nils", "Ada", "Bo"];
    render(<Typing names={names} />);
    expect(names).toEqual(["Nils", "Ada", "Bo"]);
  });
});
