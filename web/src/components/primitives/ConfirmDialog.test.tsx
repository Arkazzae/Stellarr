import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider, useConfirm, usePrompt } from "./ConfirmDialog";

/** Asks the question on click and reports the answer, the way a call site does. */
function Asker({ onAnswer }: { onAnswer: (confirmed: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm({
          title: "Usunąć tę wiadomość?",
          description: "Tego nie da się cofnąć.",
          confirmLabel: "Usuń",
          danger: true,
        }).then(onAnswer);
      }}
    >
      Zapytaj
    </button>
  );
}

/** The same, for the variant that also wants words. */
function Prompter({
  onAnswer,
  optional = false,
}: {
  onAnswer: (value: string | null) => void;
  optional?: boolean;
}) {
  const prompt = usePrompt();
  return (
    <button
      type="button"
      onClick={() => {
        void prompt({
          title: "Zbanować Jo?",
          confirmLabel: "Zbanuj",
          danger: true,
          field: { label: "POWÓD", placeholder: "Bez podanego powodu", optional },
        }).then(onAnswer);
      }}
    >
      Zapytaj o powód
    </button>
  );
}

function setup() {
  const onAnswer = vi.fn();
  render(
    <ConfirmProvider>
      <Asker onAnswer={onAnswer} />
    </ConfirmProvider>,
  );
  return { onAnswer, user: userEvent.setup() };
}

function setupPrompt(optional = true) {
  const onAnswer = vi.fn();
  render(
    <ConfirmProvider>
      <Prompter onAnswer={onAnswer} optional={optional} />
    </ConfirmProvider>,
  );
  return { onAnswer, user: userEvent.setup() };
}

describe("ConfirmProvider", () => {
  it("asks nothing until somebody asks", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves true only when the deed's own button is pressed", async () => {
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole("button", { name: "Zapytaj" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Usunąć tę wiadomość?");
    expect(dialog).toHaveTextContent("Tego nie da się cofnąć.");

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("answers no to the cancel button and to Escape", async () => {
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole("button", { name: "Zapytaj" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onAnswer).toHaveBeenNthCalledWith(1, false);

    await user.click(screen.getByRole("button", { name: "Zapytaj" }));
    await user.keyboard("{Escape}");
    expect(onAnswer).toHaveBeenNthCalledWith(2, false);
  });

  it("treats a tap on the clear mobile layer as cancel", async () => {
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole("button", { name: "Zapytaj" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.click(dialog);
    await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it("opens on the harmless answer, so a stray Enter costs nothing", async () => {
    const { onAnswer, user } = setup();

    await user.click(screen.getByRole("button", { name: "Zapytaj" }));
    expect(screen.getByRole("button", { name: "Anuluj" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("hands back what was typed, trimmed, and null when dismissed", async () => {
    const { onAnswer, user } = setupPrompt();

    await user.click(screen.getByRole("button", { name: "Zapytaj o powód" }));
    // A question that wants words starts in the field, not on a button.
    const field = screen.getByRole("textbox", { name: "POWÓD" });
    expect(field).toHaveFocus();

    // Enter belongs to the field it was typed in.
    await user.type(field, "  spam  {Enter}");
    expect(onAnswer).toHaveBeenNthCalledWith(1, "spam");

    await user.click(screen.getByRole("button", { name: "Zapytaj o powód" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onAnswer).toHaveBeenNthCalledWith(2, null);
  });

  it("forgets the last answer before asking again", async () => {
    const { onAnswer, user } = setupPrompt();

    await user.click(screen.getByRole("button", { name: "Zapytaj o powód" }));
    await user.type(screen.getByRole("textbox", { name: "POWÓD" }), "spam");
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    await user.click(screen.getByRole("button", { name: "Zapytaj o powód" }));
    expect(screen.getByRole("textbox", { name: "POWÓD" })).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Zbanuj" }));
    // Empty is a valid answer to an optional field; null is not what it means.
    expect(onAnswer).toHaveBeenLastCalledWith("");
  });

  it("holds the deed back while a required field is empty", async () => {
    const { user } = setupPrompt(false);

    await user.click(screen.getByRole("button", { name: "Zapytaj o powód" }));
    expect(screen.getByRole("button", { name: "Zbanuj" })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "POWÓD" }), "spam");
    expect(screen.getByRole("button", { name: "Zbanuj" })).toBeEnabled();
  });
});
