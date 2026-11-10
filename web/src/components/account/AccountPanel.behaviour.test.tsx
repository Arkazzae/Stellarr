import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountPanel, type AccountPanelProps } from "./AccountPanel";

function props(overrides: Partial<AccountPanelProps> = {}): AccountPanelProps {
  return {
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
}

const statusField = () => screen.getByRole("textbox", { name: "Twój status" });

afterEach(() => {
  vi.useRealTimers();
});

describe("AccountPanel status line", () => {
  it("takes an emoji that carries a variation selector off again", async () => {
    const user = userEvent.setup();
    render(<AccountPanel {...props({ customStatus: "🛠️ w warsztacie" })} />);

    const tools = screen.getByRole("button", { name: "Zacznij status od 🛠️" });
    expect(tools).toHaveAttribute("aria-pressed", "true");

    await user.click(tools);

    expect(statusField()).toHaveValue("w warsztacie");
    expect(tools).toHaveAttribute("aria-pressed", "false");
  });

  it("treats a leading custom shortcode as the status emoji", async () => {
    const user = userEvent.setup();
    render(<AccountPanel {...props({ customStatus: ":party: hej" })} />);

    await user.click(screen.getByRole("button", { name: "Zacznij status od 📚" }));

    expect(statusField()).toHaveValue("📚 hej");
  });

  it("offers saving only once the line differs from the saved status", async () => {
    const user = userEvent.setup();
    render(<AccountPanel {...props({ customStatus: "na linii" })} />);

    const save = screen.getByRole("button", { name: "Zapisz" });
    expect(save).toBeDisabled();

    await user.type(statusField(), " 2");
    expect(save).toBeEnabled();
  });

  it("saves the trimmed line on Ctrl+Enter and confirms it briefly", async () => {
    const onSaveCustomStatus = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(
      <AccountPanel {...props({ onSaveCustomStatus })} />,
    );

    await user.type(statusField(), "  praca  ");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onSaveCustomStatus).toHaveBeenCalledExactlyOnceWith("praca");

    // The parent stores the status; the button then reads as saved.
    rerender(
      <AccountPanel {...props({ onSaveCustomStatus, customStatus: "praca" })} />,
    );
    expect(screen.getByRole("button", { name: "Zapisz" })).toHaveAttribute(
      "title",
      "Zapisano",
    );

    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole("button", { name: "Zapisz" })).toHaveAttribute(
      "title",
      "Zapisz",
    );
  });

  it("does not save an unchanged line", () => {
    const onSaveCustomStatus = vi.fn();
    render(
      <AccountPanel
        {...props({ onSaveCustomStatus, customStatus: "bez zmian" })}
      />,
    );

    fireEvent.keyDown(statusField(), { key: "Enter", ctrlKey: true });

    expect(onSaveCustomStatus).not.toHaveBeenCalled();
  });

  it("starts the draft over when the saved status changes elsewhere", () => {
    const { rerender } = render(
      <AccountPanel {...props({ customStatus: "pierwszy" })} />,
    );
    fireEvent.change(statusField(), { target: { value: "w trakcie pisania" } });

    rerender(<AccountPanel {...props({ customStatus: "z innej karty" })} />);

    expect(statusField()).toHaveValue("z innej karty");
  });

  it("limits the line to 128 characters", () => {
    render(<AccountPanel {...props()} />);

    expect(statusField()).toHaveAttribute("maxlength", "128");
  });
});

describe("AccountPanel actions", () => {
  it("opens settings and signs out through their own buttons", async () => {
    const user = userEvent.setup();
    const panel = props();
    render(<AccountPanel {...panel} />);

    await user.click(screen.getByRole("button", { name: "Ustawienia użytkownika" }));
    await user.click(screen.getByRole("button", { name: "Wyloguj się" }));

    expect(panel.onOpenSettings).toHaveBeenCalledOnce();
    expect(panel.onLogout).toHaveBeenCalledOnce();
  });

  it("marks the chosen availability and reports a pick", async () => {
    const user = userEvent.setup();
    const panel = props({ presence: "dnd" });
    render(<AccountPanel {...panel} />);

    expect(
      screen.getByRole("button", { name: "Nie przeszkadzać" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Zaraz wracam/ }));

    expect(panel.onSetPresence).toHaveBeenCalledWith("idle");
  });

  it.each([
    ["presence", { presenceSupported: false }],
    ["custom status", { customStatusSupported: false }],
  ] as const)("says the status is kept on this device when %s is not stored", (_what, overrides) => {
    render(<AccountPanel {...props(overrides)} />);

    expect(screen.getByText("Status zostaje na tym urządzeniu.")).toBeVisible();
  });

  it("stays quiet about local storage when everything is stored", () => {
    const { container } = render(<AccountPanel {...props()} />);

    expect(container.querySelector(".acc-note")).toBeNull();
  });
});
