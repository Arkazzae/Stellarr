import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppSkeleton } from "./AppSkeleton";
import styles from "./AppSkeleton.module.css";

describe("AppSkeleton", () => {
  it("announces that the application is busy", () => {
    render(<AppSkeleton />);

    const skeleton = screen.getByRole("region", {
      name: "Wczytywanie serwera…",
    });
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Wczytywanie serwera…");
  });

  it("uses the provided loading label consistently", () => {
    render(<AppSkeleton label="Przygotowywanie rozmowy…" />);

    expect(
      screen.getByRole("region", { name: "Przygotowywanie rozmowy…" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Przygotowywanie rozmowy…",
    );
  });

  it("keeps the visual placeholders out of the accessibility tree", () => {
    render(<AppSkeleton />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("reserves every standard room-header action before the shell loads", () => {
    const { container } = render(<AppSkeleton />);
    const tools = container.querySelector(`.${styles.headerTools}`);

    expect(tools).not.toBeNull();
    expect(tools?.children).toHaveLength(3);
  });
});
