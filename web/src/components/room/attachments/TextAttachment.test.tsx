import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translateMessage } from "@/i18n";
import { parseInline } from "../parts";
import { TextAttachment } from "./TextAttachment";

describe("message Markdown", () => {
  it("renders formatting semantically and keeps nested mentions recognizable", () => {
    render(<TextAttachment
      locale="pl" t={(key, values) => translateMessage("pl", key, values)}
      nodes={parseInline("Ocena **6/10**. *Kursywa* i ~~stare~~. **@ada `kod`**", {
        mentions: new Map([["ada", { userId: "ada-id", username: "ada", displayName: "Ada", self: true }]]),
      })}
    />);
    expect(screen.getByText("6/10").tagName).toBe("STRONG");
    expect(screen.getByText("Kursywa").tagName).toBe("EM");
    expect(screen.getByText("stare").tagName).toBe("DEL");
    expect(screen.getByText("@ada")).toHaveClass("msg-mention", "self");
    expect(screen.getByText("kod").tagName).toBe("CODE");
  });
  it("hides a spoiler until it is clicked or opened from the keyboard", () => {
    render(<TextAttachment
      locale="pl" t={(key, values) => translateMessage("pl", key, values)}
      nodes={parseInline("Morderca to ||lokaj|| i ||ogrodnik||")}
    />);
    const [first, second] = screen.getAllByRole("button", { name: "Spoiler (kliknij, aby odsłonić)" });
    expect(first).toHaveClass("msg-spoiler");
    expect(first).not.toHaveClass("revealed");
    fireEvent.click(first!);
    expect(screen.getByText("lokaj").closest(".msg-spoiler")).toHaveClass("revealed");
    fireEvent.keyDown(second!, { key: "Enter" });
    expect(screen.queryAllByRole("button", { name: "Spoiler (kliknij, aby odsłonić)" })).toHaveLength(0);
  });
  it("never turns authored HTML into elements", () => {
    const { container } = render(<TextAttachment
      locale="pl" t={(key, values) => translateMessage("pl", key, values)}
      nodes={parseInline('**<img src=x onerror="alert(1)">** [klik](javascript:alert(1))')}
    />);
    expect(container.querySelector("img,script,a")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
