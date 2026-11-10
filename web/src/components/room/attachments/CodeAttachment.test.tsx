import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { tokenizeCode } from "../codeLanguages";
import type { CodePart } from "../parts";

import { CodeAttachment } from "./CodeAttachment";

function codePart(source: string): CodePart {
  return {
    kind: "code",
    lang: "example.ts",
    source,
    language: "typescript",
    tokens: tokenizeCode(source, "typescript"),
  };
}

describe("CodeAttachment", () => {
  it("lets the reader choose highlighting without changing the source", async () => {
    const user = userEvent.setup();
    const source = "const value = 1\ndef greet():\n  print('hej')";
    const onCopy = vi.fn();
    render(<CodeAttachment part={codePart(source)} onCopy={onCopy} />);

    const select = screen.getByRole("combobox", { name: "Język podświetlania" });
    expect(screen.queryByText("example.ts")).toBeNull();
    expect(select).toHaveValue("typescript");
    expect(screen.getByText("const", { selector: ".kw" })).toBeInTheDocument();

    await user.selectOptions(select, "python");
    expect(select).toHaveValue("python");
    expect(screen.getByText("def", { selector: ".kw" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kopiuj kod" }));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({
      source,
      language: "python",
    }));
    expect(screen.getByRole("button", { name: "Skopiowano kod" })).toBeInTheDocument();
  });

  it("embeds a long listing in a compact, expandable code window", async () => {
    const user = userEvent.setup();
    const source = Array.from({ length: 20 }, (_, index) => `const line${index} = ${index};`).join("\n");
    render(<CodeAttachment part={codePart(source)} />);

    const pre = screen.getByLabelText("Kod — TypeScript");
    expect(pre.closest(".att-code")).toHaveClass("att-window");
    expect(pre).toHaveClass("compact");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("20 wierszy")).toBeInTheDocument();
    expect(document.querySelectorAll(".code-line")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "powiększ" }))
      .toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "powiększ" }));
    expect(pre).toHaveClass("expanded");
    expect(screen.getByRole("button", { name: "zmniejsz" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
