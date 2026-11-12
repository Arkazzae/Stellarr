import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { MessageToolbar } from "./MessageToolbar";

const picker = () => screen.queryByRole("dialog", { name: "Wybierz reakcję" });
const pickerTrigger = () => screen.getByRole("button", { name: "Wybierz reakcję" });
const sheet = () => screen.queryByRole("dialog", { name: "Akcje wiadomości" });

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = "";
});

describe("MessageToolbar reaction picker", () => {
  it("reacts with the shortcode when the pick is a server emoji", async () => {
    const user = userEvent.setup();
    const onReact = vi.fn();
    renderWithConfirm(
      <MessageToolbar
        customEmoji={[{ id: "e-1", shortcode: ":mushris:", glyph: "https://cdn.example/m.png" }]}
        onReact={onReact}
        onAction={vi.fn()}
      />,
    );

    await user.click(pickerTrigger());
    await user.type(screen.getByRole("textbox", { name: "Szukaj emoji" }), "mushr");
    await user.click(screen.getByRole("option", { name: ":mushris:" }));

    expect(onReact).toHaveBeenCalledExactlyOnceWith(":mushris:");
  });

  it("closes on Escape and hands focus back to the button that opened it", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />);

    await user.click(pickerTrigger());
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Szukaj emoji" })).toHaveFocus(),
    );
    await user.keyboard("{Escape}");

    expect(picker()).toBeNull();
    expect(pickerTrigger()).toHaveFocus();
  });

  it("closes on Escape pressed outside the search field too", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />);

    await user.click(pickerTrigger());
    screen.getByRole("textbox", { name: "Szukaj emoji" }).blur();
    await user.keyboard("{Escape}");

    expect(picker()).toBeNull();
    expect(pickerTrigger()).toHaveFocus();
  });

  it("closes when the same button is pressed again", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />);

    await user.click(pickerTrigger());
    expect(pickerTrigger()).toHaveAttribute("aria-expanded", "true");
    await user.click(pickerTrigger());

    expect(picker()).toBeNull();
    expect(pickerTrigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when something outside it is pressed", async () => {
    const user = userEvent.setup();
    renderWithConfirm(
      <>
        <p>elsewhere</p>
        <MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />
      </>,
    );

    await user.click(pickerTrigger());
    await user.click(screen.getByText("elsewhere"));

    expect(picker()).toBeNull();
  });

  it("stays open while its own panel is pressed", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />);

    await user.click(pickerTrigger());
    await user.click(screen.getByRole("textbox", { name: "Szukaj emoji" }));

    expect(picker()).not.toBeNull();
  });

  it("opens above the message when there is little room below it", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />);
    vi.spyOn(screen.getByRole("toolbar"), "getBoundingClientRect").mockReturnValue(
      new DOMRect(900, window.innerHeight - 100, 100, 30),
    );

    await user.click(pickerTrigger());

    expect(picker()).toHaveClass("up");
    expect(picker()).toHaveStyle({ bottom: `${100 + 6}px` });
  });

  it("opens below the message when there is room", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={vi.fn()} />);
    vi.spyOn(screen.getByRole("toolbar"), "getBoundingClientRect").mockReturnValue(
      new DOMRect(900, 20, 100, 30),
    );

    await user.click(pickerTrigger());

    expect(picker()).not.toHaveClass("up");
    expect(picker()).toHaveStyle({ top: "56px" });
  });
});

describe("MessageToolbar actions", () => {
  it("offers the thread to anyone", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithConfirm(<MessageToolbar onReact={vi.fn()} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Otwórz wątek" }));

    expect(onAction).toHaveBeenCalledExactlyOnceWith("thread");
  });

  it("does nothing on a press when no handler is given", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar own />);

    await user.click(screen.getByRole("button", { name: "Usuń" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks the pin as pressed only when the message is pinned", () => {
    const { unmount } = renderWithConfirm(<MessageToolbar canModerate onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Przypnij" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    unmount();

    renderWithConfirm(<MessageToolbar canModerate pinned onAction={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Odepnij" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("MessageToolbar action sheet", () => {
  it("asks before deleting from the sheet, as the toolbar does", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithConfirm(<MessageToolbar own onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Akcje wiadomości" }));
    await user.click(within(sheet() as HTMLElement).getByRole("button", { name: "Usuń" }));
    expect(onAction).not.toHaveBeenCalled();
    await answerConfirm(user, "Usuń");

    expect(onAction).toHaveBeenCalledExactlyOnceWith("delete");
  });

  it("names the pin by its direction and reports its state", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar canModerate pinned onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Akcje wiadomości" }));

    expect(
      within(sheet() as HTMLElement).getByRole("button", { name: "Odepnij" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("locks page scroll while open and gives it back when it closes", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "auto";
    renderWithConfirm(<MessageToolbar onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Akcje wiadomości" }));
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(within(sheet() as HTMLElement).getByRole("button", { name: "Zamknij" }));

    expect(sheet()).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("closes on Escape and returns focus to the button that opened it", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onAction={vi.fn()} />);
    const more = screen.getByRole("button", { name: "Akcje wiadomości" });

    await user.click(more);
    await user.keyboard("{Escape}");

    expect(sheet()).toBeNull();
    expect(more).toHaveFocus();
  });

  it("closes when the layer behind the sheet is pressed", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Akcje wiadomości" }));
    const layer = (sheet() as HTMLElement).parentElement as HTMLElement;
    fireEvent.pointerDown(within(layer).getByRole("heading"));
    expect(sheet()).not.toBeNull();
    fireEvent.pointerDown(layer);

    expect(sheet()).toBeNull();
  });

  it("keeps Tab inside the sheet", async () => {
    const user = userEvent.setup();
    renderWithConfirm(<MessageToolbar own onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Akcje wiadomości" }));
    const buttons = within(sheet() as HTMLElement).getAllByRole("button");
    // The sheet takes focus a frame after it opens; wait for that before moving it.
    await waitFor(() => expect(buttons[0]).toHaveFocus());
    (buttons.at(-1) as HTMLElement).focus();
    await user.tab();

    expect(buttons[0]).toHaveFocus();
  });
});
