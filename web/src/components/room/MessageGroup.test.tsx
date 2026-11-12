import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { MessageGroup, type MessageGroupProps } from "./MessageGroup";

afterEach(() => vi.restoreAllMocks());

function body(id: string, text: string) {
  return { id, parts: [{ kind: "text" as const, nodes: [{ kind: "text" as const, text }] }] };
}

function setup(overrides: Partial<MessageGroupProps> = {}) {
  const props: MessageGroupProps = {
    id: "m-1",
    authorId: "u-1",
    authorName: "Maja",
    timestamp: "2026-08-13T10:00:00Z",
    bodies: [body("m-1", "pierwsza"), body("m-2", "druga")],
    own: true,
    ...overrides,
  };
  renderWithConfirm(<MessageGroup {...props} />);
  return props;
}

describe("MessageGroup inline editing", () => {
  it("edits the message in its own place, leaving the rest of the block alone", () => {
    setup({ editing: { id: "m-2", original: "druga" } });

    // The one being rewritten is a field; its neighbour is still a message.
    expect(screen.getByRole("textbox", { name: "Edytuj wiadomość" })).toHaveValue(
      "druga",
    );
    expect(screen.getByText("pierwsza")).toBeInTheDocument();
    // `queryByText` would find the textarea, whose value is that same string —
    // the point is that no *message body* is rendering it any more.
    expect(screen.queryByText("druga", { selector: ".msg-body" })).toBeNull();
  });

  it("opens with the caret at the end and nothing selected", () => {
    setup({ editing: { id: "m-1", original: "pierwsza" } });

    const field = screen.getByRole("textbox", {
      name: "Edytuj wiadomość",
    }) as HTMLTextAreaElement;
    expect(field).toHaveFocus();
    // A selected body would be wiped by the first keystroke of somebody who
    // came to change one word.
    expect(field.selectionStart).toBe("pierwsza".length);
    expect(field.selectionEnd).toBe("pierwsza".length);
  });

  it("saves on Enter, against the id of the message being edited", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    setup({ editing: { id: "m-2", original: "druga" }, onEditSave });

    await user.type(
      screen.getByRole("textbox", { name: "Edytuj wiadomość" }),
      " poprawiona{Enter}",
    );

    expect(onEditSave).toHaveBeenCalledWith("m-2", "druga poprawiona");
  });

  it("keeps a line break on Shift+Enter instead of saving", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    setup({ editing: { id: "m-1", original: "linia" }, onEditSave });

    await user.type(
      screen.getByRole("textbox", { name: "Edytuj wiadomość" }),
      "{Shift>}{Enter}{/Shift}druga",
    );

    expect(onEditSave).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Edytuj wiadomość" })).toHaveValue(
      "linia\ndruga",
    );
  });

  it("gives up on Escape without saving", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    setup({ editing: { id: "m-1", original: "linia" }, onEditSave, onEditCancel });

    await user.type(
      screen.getByRole("textbox", { name: "Edytuj wiadomość" }),
      " zmiana{Escape}",
    );

    expect(onEditCancel).toHaveBeenCalledOnce();
    expect(onEditSave).not.toHaveBeenCalled();
  });

  it("treats an unchanged save as a cancel, so nothing is marked edited", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    setup({ editing: { id: "m-1", original: "bez zmian" }, onEditSave, onEditCancel });

    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(onEditSave).not.toHaveBeenCalled();
    expect(onEditCancel).toHaveBeenCalledOnce();
  });

  it("will not save an emptied message — that is what the bin is for", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    setup({ editing: { id: "m-1", original: "coś" }, onEditSave });

    await user.clear(screen.getByRole("textbox", { name: "Edytuj wiadomość" }));

    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(onEditSave).not.toHaveBeenCalled();
  });

  it("keeps the text in the field when the save fails", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn().mockRejectedValue(new Error("offline"));
    setup({ editing: { id: "m-1", original: "stare" }, onEditSave });

    await user.type(
      screen.getByRole("textbox", { name: "Edytuj wiadomość" }),
      " nowe{Enter}",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać",
    );
    expect(screen.getByRole("textbox", { name: "Edytuj wiadomość" })).toHaveValue(
      "stare nowe",
    );
  });

  it("renders every message of a block when nothing is being edited", () => {
    setup();

    expect(screen.getByText("pierwsza")).toBeInTheDocument();
    expect(screen.getByText("druga")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("edits the exact message whose toolbar was used", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    setup({ onAction });
    const second = screen.getByText("druga").closest(".msg-entry");

    expect(second).not.toBeNull();
    await user.click(within(second as HTMLElement).getByRole("button", { name: "Edytuj" }));

    expect(onAction).toHaveBeenCalledExactlyOnceWith("m-2", "edit");
  });

  it("deletes the exact message whose toolbar was used", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    setup({ onAction });
    const second = screen.getByText("druga").closest(".msg-entry");

    expect(second).not.toBeNull();
    await user.click(within(second as HTMLElement).getByRole("button", { name: "Usuń" }));
    await answerConfirm(user, "Usuń");

    expect(onAction).toHaveBeenCalledExactlyOnceWith("m-2", "delete");
  });

  it("keeps pin state and reactions scoped to their message", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onReact = vi.fn();
    setup({
      canModerate: true,
      onAction,
      onReact,
      bodies: [
        body("m-1", "pierwsza"),
        {
          ...body("m-2", "druga"),
          pinned: true,
          reactions: [{ emoji: "🔥", count: 2, mine: false }],
        },
      ],
    });
    const first = screen.getByText("pierwsza").closest(".msg-entry");
    const second = screen.getByText("druga").closest(".msg-entry");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(within(first as HTMLElement).getByRole("button", { name: "Przypnij" }))
      .toBeInTheDocument();
    await user.click(
      within(second as HTMLElement).getByRole("button", { name: "Odepnij" }),
    );
    await user.click(
      within(second as HTMLElement).getByRole("button", { name: "🔥, liczba reakcji: 2" }),
    );

    expect(onAction).toHaveBeenCalledExactlyOnceWith("m-2", "pin");
    expect(onReact).toHaveBeenCalledExactlyOnceWith("m-2", "🔥");
  });

  it("collapses long prose behind a show-more control", async () => {
    const user = userEvent.setup();
    const long = "Długi fragment wiadomości do przeczytania. ".repeat(22);
    setup({ bodies: [body("m-1", long), body("m-2", "krótka odpowiedź")] });

    const toggle = screen.getByRole("button", { name: "Zobacz więcej" });
    const content = toggle.previousElementSibling;
    expect(content).toHaveClass("collapsed");
    expect(screen.getByText("krótka odpowiedź")).toBeInTheDocument();

    await user.click(toggle);
    expect(content).not.toHaveClass("collapsed");
    expect(screen.getByRole("button", { name: "Pokaż mniej" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("does not add a disclosure to a short message", () => {
    setup({ bodies: [body("m-1", "krótko")] });
    expect(screen.queryByRole("button", { name: "Zobacz więcej" })).toBeNull();
  });
});

describe("MessageGroup context menu", () => {
  it("opens a thread for the exact message from its right-click menu", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    setup({ onAction });

    fireEvent.contextMenu(screen.getByText("druga"));
    await user.click(screen.getByRole("menuitem", { name: "Otwórz wątek" }));

    expect(onAction).toHaveBeenCalledWith("m-2", "thread");
  });

  it("downloads the exact gallery image under the pointer", async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    setup({
      bodies: [{
        id: "m-media",
        parts: [{
          kind: "gallery",
          images: [
            { src: "/media/first.png", alt: "first.png" },
            { src: "/media/second.png", alt: "second.png" },
          ],
        }],
      }],
    });

    fireEvent.contextMenu(screen.getByRole("img", { name: "second.png" }));
    await user.click(screen.getByRole("menuitem", { name: "Pobierz" }));

    expect(click).toHaveBeenCalledOnce();
    const downloaded = click.mock.instances[0];
    expect(downloaded).toHaveAttribute("href", "/media/second.png");
    expect(downloaded).toHaveAttribute("download", "second.png");
  });

  it("does not offer download for a text-only message", () => {
    setup();

    fireEvent.contextMenu(screen.getByText("druga"));

    expect(screen.queryByRole("menuitem", { name: "Pobierz" })).toBeNull();
  });
});

describe("MessageGroup server notices", () => {
  it("renders the server name and icon without exposing profile actions", () => {
    const onOpenAuthor = vi.fn();
    setup({
      authorId: "system",
      authorName: "Orbit",
      authorAvatarUrl: "/assets/orbit.webp",
      system: true,
      onOpenAuthor,
    });

    expect(screen.getByText("Orbit")).toBeVisible();
    expect(document.querySelector(".av img")).toHaveAttribute(
      "src",
      "/assets/orbit.webp",
    );
    expect(screen.queryByRole("button", { name: "Profil: Orbit" })).toBeNull();
    expect(onOpenAuthor).not.toHaveBeenCalled();
  });
});
