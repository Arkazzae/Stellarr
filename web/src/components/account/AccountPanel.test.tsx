import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountPanel, type AccountPanelProps } from "./AccountPanel";

function setup(overrides: Partial<AccountPanelProps> = {}) {
  const props: AccountPanelProps = {
    presence: "online",
    presenceSupported: true,
    customStatus: "",
    customStatusSupported: true,
    onSetPresence: vi.fn(),
    onSaveCustomStatus: vi.fn(),
    onOpenSettings: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  render(<AccountPanel {...props} />);
  return { props, user: userEvent.setup() };
}

describe("AccountPanel status", () => {
  it("shows the four compact presence choices without explanatory copy", () => {
    setup();

    expect(
      screen.getByRole("button", { name: "Nie przeszkadzać" }),
    ).not.toHaveTextContent("nic nie wycisza");
    expect(screen.getByRole("button", { name: /Online/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("picks a state without closing over the rest of the panel", async () => {
    const { props, user } = setup();

    await user.click(screen.getByRole("button", { name: /Niewidoczny/ }));

    expect(props.onSetPresence).toHaveBeenCalledWith("offline");
  });

  it("opens the line with a suggestion, and takes it off again", async () => {
    const { user } = setup();

    const field = screen.getByRole("textbox", { name: "Twój status" });
    await user.type(field, "gram w coś");
    await user.click(
      screen.getByRole("button", { name: "Zacznij status od 🎮" }),
    );
    expect(field).toHaveValue("🎮 gram w coś");

    await user.click(
      screen.getByRole("button", { name: "Zacznij status od 🎧" }),
    );
    expect(field).toHaveValue("🎧 gram w coś");

    await user.click(
      screen.getByRole("button", { name: "Zacznij status od 🎧" }),
    );
    expect(field).toHaveValue("gram w coś");
  });

  it("keeps the emoji row above a two-line field and has no clear action", () => {
    setup({ customStatus: "🎧 na słuchawkach" });

    const quickEmoji = screen.getByRole("button", {
      name: "Zacznij status od 🎧",
    });
    const field = screen.getByRole("textbox", { name: "Twój status" });

    expect(quickEmoji.parentElement?.nextElementSibling).toContainElement(
      field,
    );
    expect(field).toHaveAttribute("rows", "2");
    expect(screen.queryByRole("button", { name: "Wyczyść" })).toBeNull();
  });

  it("saves the quick line as a custom status, not as a bio", async () => {
    const { props, user } = setup();

    await user.type(
      screen.getByRole("textbox", { name: "Twój status" }),
      "🎧 na słuchawkach",
    );
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(props.onSaveCustomStatus).toHaveBeenCalledWith(
      "🎧 na słuchawkach",
    );
  });

  it("opens the full picker and uses a custom emoji as the status icon", async () => {
    const { user } = setup({
      customEmoji: [
        {
          id: "emoji-party",
          shortcode: ":party:",
          glyph: "/emoji/party.webp",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Dodaj emoji" }));
    expect(screen.getByRole("textbox", { name: "Szukaj emoji" })).toBeVisible();

    await user.click(screen.getByRole("option", { name: ":party:" }));

    expect(screen.getByRole("textbox", { name: "Twój status" })).toHaveValue(
      ":party:",
    );
  });

  it("keeps emoji search unfocused when the catalogue is opened by touch", () => {
    setup();

    const trigger = screen.getByRole("button", { name: "Dodaj emoji" });
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger, { detail: 1 });

    expect(
      screen.getByRole("textbox", { name: "Szukaj emoji" }),
    ).not.toHaveFocus();
  });

  it("focuses emoji search when the catalogue is opened from a keyboard", async () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Dodaj emoji" }), {
      detail: 0,
    });

    await vi.waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Szukaj emoji" }),
      ).toHaveFocus();
    });
  });
});
