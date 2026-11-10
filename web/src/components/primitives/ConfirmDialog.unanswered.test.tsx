import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmProvider, useConfirm, usePrompt, type Confirm, type Prompt } from "./ConfirmDialog";

/** Hands the provider's functions to the test so it can ask without a button. */
function captureAsking() {
  const asking: { confirm?: Confirm; prompt?: Prompt } = {};
  function Capture() {
    asking.confirm = useConfirm();
    asking.prompt = usePrompt();
    return null;
  }
  const view = render(
    <ConfirmProvider>
      <Capture />
    </ConfirmProvider>,
  );
  return {
    view,
    confirm: (title: string) => asking.confirm!({ title, confirmLabel: "Tak" }),
    prompt: (title: string) =>
      asking.prompt!({ title, confirmLabel: "Dalej", field: { label: "Powód" } }),
  };
}

describe("ConfirmProvider questions that go unanswered", () => {
  it("answers no to a question that a newer one replaces", async () => {
    const user = userEvent.setup();
    const { confirm } = captureAsking();
    const first = vi.fn();
    const second = vi.fn();

    void confirm("Pierwsze?").then(first);
    await screen.findByRole("dialog", { name: "Pierwsze?" });
    void confirm("Drugie?").then(second);
    await screen.findByRole("dialog", { name: "Drugie?" });

    await vi.waitFor(() => expect(first).toHaveBeenCalledWith(false));
    expect(second).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Tak" }));
    expect(second).toHaveBeenCalledWith(true);
    expect(first).toHaveBeenCalledOnce();
  });

  it("answers a replaced prompt with null, not false", async () => {
    const { confirm, prompt } = captureAsking();
    const answer = vi.fn();

    void prompt("Powód?").then(answer);
    await screen.findByRole("dialog", { name: "Powód?" });
    void confirm("Na pewno?");

    await vi.waitFor(() => expect(answer).toHaveBeenCalledWith(null));
  });

  it("answers no when the provider leaves the page", async () => {
    const { view, confirm } = captureAsking();
    const answer = vi.fn();

    void confirm("Usunąć?").then(answer);
    await screen.findByRole("dialog");
    view.unmount();

    await vi.waitFor(() => expect(answer).toHaveBeenCalledWith(false));
  });

  it("refuses to be used without a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useConfirm())).toThrow(/ConfirmProvider/);
    expect(() => renderHook(() => usePrompt())).toThrow(/ConfirmProvider/);
  });
});
