import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("publishes its variant and size for the stylesheet", () => {
    render(
      <Button variant="outline" size="sm" className="w-full">
        Refresh
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toHaveClass("ui-button", "w-full");
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toHaveAttribute("data-size", "sm");
  });

  it("defaults to the accent fill at the regular size", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "default");
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "default");
  });

  it("draws a link as itself with asChild, keeping both classes", () => {
    render(
      <Button asChild className="mt-6">
        <a href="/" className="own">
          Home
        </a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Home" });
    expect(link).toHaveClass("ui-button", "mt-6", "own");
    expect(link).toHaveAttribute("data-variant", "default");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("runs the child's handler before its own, which the child can stop", () => {
    const calls: string[] = [];
    render(
      <Button asChild onClick={() => calls.push("button")}>
        <a
          href="/"
          onClick={(event) => {
            calls.push("link");
            event.preventDefault();
          }}
        >
          Go
        </a>
      </Button>,
    );

    fireEvent.click(screen.getByRole("link"));

    expect(calls).toEqual(["link", "button"]);
  });

  it("passes a ref through asChild", () => {
    const ref = vi.fn();
    render(
      <Button asChild ref={ref}>
        <a href="/">Go</a>
      </Button>,
    );

    expect(ref).toHaveBeenCalledWith(screen.getByRole("link"));
  });
});
