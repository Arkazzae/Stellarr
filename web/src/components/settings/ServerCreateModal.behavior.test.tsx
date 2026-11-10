import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ServerCreateModal } from "./ServerCreateModal";

const nameField = () => screen.getByRole("textbox", { name: /Nazwa serwera/ });

describe("ServerCreateModal", () => {
  it("returns to the basics pane to report a failure raised from another pane", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error("Ta nazwa jest już zajęta."));

    render(<ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(nameField(), "Załoga");
    await user.click(screen.getByRole("button", { name: "Powiadomienia" }));
    expect(screen.queryByRole("textbox", { name: /Nazwa serwera/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Utwórz serwer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ta nazwa jest już zajęta.");
    expect(nameField()).toHaveValue("Załoga");
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
  });

  it("words the failure itself when the rejection carries no message", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue("refused");

    render(<ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(nameField(), "Załoga");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się utworzyć serwera. Sprawdź dane i spróbuj ponownie.",
    );
  });

  it("stays open until the creation settles", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();

    render(<ServerCreateModal open onClose={onClose} onCreate={onCreate} />);

    await user.type(nameField(), "Załoga");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does not submit without a name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(nameField(), "   ");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Utwórz serwer" })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("starts from a blank draft on the first pane every time it opens", async () => {
    const user = userEvent.setup();
    const props = { onClose: vi.fn(), onCreate: vi.fn() };
    const { rerender } = render(<ServerCreateModal open {...props} />);

    await user.type(nameField(), "Załoga");
    await user.click(screen.getByRole("button", { name: "Widoczność" }));
    await user.click(screen.getByRole("button", { name: "Serwer publiczny" }));

    rerender(<ServerCreateModal open={false} {...props} />);
    rerender(<ServerCreateModal open {...props} />);

    expect(nameField()).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Widoczność" }));
    expect(screen.getByRole("button", { name: "Serwer publiczny" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
