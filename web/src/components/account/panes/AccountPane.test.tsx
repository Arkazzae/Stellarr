import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountPane } from "./AccountPane";

const account = {
  id: "account-test-user",
  username: "patryk",
  displayName: "Patryk",
  createdAt: "2026-08-30T12:00:00.000Z",
  customStatus: "",
  bio: "",
  pronouns: "",
};

describe("AccountPane", () => {
  it("inserts a touch-picked bio emoji without raising either text field", async () => {
    render(
      <AccountPane
        account={account}
        onSave={vi.fn()}
        onPickImage={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    );

    const bio = screen.getByRole("textbox", { name: /^O mnie/ });
    const trigger = screen.getByRole("button", { name: "Dodaj emoji" });
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger, { detail: 1 });

    expect(
      screen.getByRole("textbox", { name: "Szukaj emoji" }),
    ).not.toHaveFocus();

    const emoji = screen.getByRole("option", { name: ":usmiech:" });
    fireEvent.pointerDown(emoji, { pointerType: "touch" });
    fireEvent.click(emoji, { detail: 1 });

    expect(bio).toHaveValue("😀");
    expect(bio).not.toHaveFocus();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });
});
