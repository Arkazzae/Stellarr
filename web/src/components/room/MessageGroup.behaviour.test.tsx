import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answerConfirm, renderWithConfirm } from "@/test/confirm";

import { MessageGroup, type MessageBodyVM, type MessageGroupProps } from "./MessageGroup";

afterEach(() => vi.restoreAllMocks());

function text(id: string, words: string): MessageBodyVM {
  return { id, parts: [{ kind: "text", nodes: [{ kind: "text", text: words }] }] };
}

function setup(overrides: Partial<MessageGroupProps> = {}) {
  renderWithConfirm(
    <MessageGroup
      id="m-1"
      authorId="u-1"
      authorName="Maja"
      timestamp="2026-08-13T10:00:00Z"
      bodies={[text("m-1", "pierwsza"), text("m-2", "druga")]}
      {...overrides}
    />,
  );
}

const menuItem = (name: string) => screen.queryByRole("menuitem", { name });

describe("MessageGroup header", () => {
  it("opens the author's profile from the name, with the name as the anchor", async () => {
    const user = userEvent.setup();
    const onOpenAuthor = vi.fn();
    setup({ onOpenAuthor });

    await user.click(screen.getByRole("button", { name: "Maja" }));

    expect(onOpenAuthor).toHaveBeenCalledOnce();
    expect(onOpenAuthor.mock.calls[0]?.[0]).toBe(screen.getByRole("button", { name: "Maja" }));
  });

  it("leaves the name as plain text when there is no profile to open", () => {
    setup();

    expect(screen.getByText("Maja")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Maja" })).toBeNull();
  });

  it("stamps the block with the instant of its first message", () => {
    setup();

    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-08-13T10:00:00Z");
  });

  it("marks a block a jump has just landed on", () => {
    setup({ highlight: true });

    expect(document.querySelector(".msg-group")).toHaveClass("jumped");
  });
});

describe("MessageGroup reply line", () => {
  const replyTo = { id: "m-0", authorId: "u-2", authorName: "Olek", preview: "co z jutrem?" };

  it("names the answered message and jumps to it", async () => {
    const user = userEvent.setup();
    const onOpenReply = vi.fn();
    setup({ replyTo, onOpenReply });

    await user.click(screen.getByRole("button", { name: /@Olek/ }));

    expect(onOpenReply).toHaveBeenCalledExactlyOnceWith("m-0");
  });

  it("draws nothing when the server says the message answers nothing", () => {
    setup({ replyTo: null as unknown as undefined });

    expect(document.querySelector(".reply-line")).toBeNull();
  });

  it("is plain text while nothing can jump", () => {
    setup({ replyTo });

    expect(screen.getByText("co z jutrem?")).toBeVisible();
    expect(screen.queryByRole("button", { name: /@Olek/ })).toBeNull();
  });
});

describe("MessageGroup bodies", () => {
  it("marks a pinned message and no other", () => {
    setup({ bodies: [text("m-1", "pierwsza"), { ...text("m-2", "druga"), pinned: true }] });

    expect(screen.getAllByText("Przypięte")).toHaveLength(1);
    expect(
      screen.getByText("druga").closest(".msg-entry")?.querySelector(".msg-pinned"),
    ).not.toBeNull();
  });

  it("draws a lone emoji at the size of a cheer", () => {
    setup({ bodies: [text("m-1", "🎉🎉")] });

    expect(document.querySelector(".msg-body")).toHaveClass("jumbo");
  });

  it("never draws a notice as a cheer", () => {
    setup({ system: true, authorId: "system", bodies: [text("m-1", "🎉🎉")] });

    expect(document.querySelector(".msg-body")).not.toHaveClass("jumbo");
  });
});

describe("MessageGroup context menu rules", () => {
  it("offers a reader no edit, pin or delete on somebody else's message", () => {
    setup({ onAction: vi.fn() });

    fireEvent.contextMenu(screen.getByText("druga"));

    expect(menuItem("Odpowiedz")).not.toBeNull();
    expect(menuItem("Edytuj")).toBeNull();
    expect(menuItem("Przypnij wiadomość")).toBeNull();
    expect(menuItem("Usuń wiadomość")).toBeNull();
  });

  it("offers the author an edit of the exact message", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    setup({ own: true, onAction });

    fireEvent.contextMenu(screen.getByText("druga"));
    await user.click(screen.getByRole("menuitem", { name: "Edytuj" }));

    expect(onAction).toHaveBeenCalledExactlyOnceWith("m-2", "edit");
  });

  it("gives a moderator the pin but no edit", () => {
    setup({ canModerate: true, onAction: vi.fn() });

    fireEvent.contextMenu(screen.getByText("pierwsza"));

    expect(menuItem("Przypnij wiadomość")).not.toBeNull();
    expect(menuItem("Edytuj")).toBeNull();
  });

  it("words the pin as an unpin on a pinned message", () => {
    setup({
      canModerate: true,
      onAction: vi.fn(),
      bodies: [{ ...text("m-1", "pierwsza"), pinned: true }],
    });

    fireEvent.contextMenu(screen.getByText("pierwsza"));

    expect(menuItem("Odepnij wiadomość")).not.toBeNull();
    expect(menuItem("Przypnij wiadomość")).toBeNull();
  });

  it("asks before deleting from the menu, and deletes only when told to", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    setup({ own: true, onAction });

    fireEvent.contextMenu(screen.getByText("druga"));
    await user.click(screen.getByRole("menuitem", { name: "Usuń wiadomość" }));
    expect(onAction).not.toHaveBeenCalled();
    await answerConfirm(user, "Anuluj");
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText("druga"));
    await user.click(screen.getByRole("menuitem", { name: "Usuń wiadomość" }));
    await answerConfirm(user, "Usuń");

    expect(onAction).toHaveBeenCalledExactlyOnceWith("m-2", "delete");
  });

  it("still lets a reader copy when nothing can act on the message", () => {
    setup();

    fireEvent.contextMenu(screen.getByText("druga"));

    expect(menuItem("Kopiuj tekst")).not.toBeNull();
    expect(menuItem("Odpowiedz")).toBeNull();
  });

  it("raises no menu on a server notice", () => {
    setup({ system: true, authorId: "system", authorName: "Orbit", onAction: vi.fn(), own: true });

    fireEvent.contextMenu(screen.getByText("druga"));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu once an item has run", async () => {
    const user = userEvent.setup();
    setup({ onAction: vi.fn() });

    fireEvent.contextMenu(screen.getByText("druga"));
    await user.click(screen.getByRole("menuitem", { name: "Odpowiedz" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("MessageGroup copying", () => {
  const written = () => vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

  it("copies what was written: emoji as their code, links as their address, no edited mark", async () => {
    const user = userEvent.setup();
    const writeText = written();
    setup({
      bodies: [
        {
          id: "m-1",
          parts: [
            {
              kind: "text",
              nodes: [
                { kind: "text", text: "patrz " },
                { kind: "emoji", shortcode: "pepe", src: "/api/emoji/e-1/image" },
                { kind: "text", text: " " },
                { kind: "link", href: "https://example.com/a", text: "tutaj" },
                { kind: "edited", at: "2026-08-13T10:05:00Z" },
              ],
            },
          ],
        },
      ],
    });

    fireEvent.contextMenu(screen.getByText("patrz", { exact: false }));
    await user.click(screen.getByRole("menuitem", { name: "Kopiuj tekst" }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith("patrz :pepe: https://example.com/a");
  });

  it("copies only the message that was clicked", async () => {
    const user = userEvent.setup();
    const writeText = written();
    setup();

    fireEvent.contextMenu(screen.getByText("pierwsza"));
    await user.click(screen.getByRole("menuitem", { name: "Kopiuj tekst" }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith("pierwsza");
  });

  it("copies the message id in developer mode", async () => {
    const user = userEvent.setup();
    const writeText = written();
    setup({ developerMode: true });

    fireEvent.contextMenu(screen.getByText("druga"));
    await user.click(screen.getByRole("menuitem", { name: "Kopiuj identyfikator" }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith("m-2");
  });

  it("keeps the id out of the menu otherwise", () => {
    setup();

    fireEvent.contextMenu(screen.getByText("druga"));

    expect(menuItem("Kopiuj identyfikator")).toBeNull();
  });
});

describe("MessageGroup saving", () => {
  const picture: MessageBodyVM = {
    id: "m-pic",
    parts: [
      { kind: "text", nodes: [{ kind: "text", text: "zobacz" }] },
      { kind: "image", src: "/media/cat.png", alt: "cat.png" },
    ],
  };

  it("saves the first file of a message when the pointer was on its words", async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    setup({ bodies: [picture] });

    fireEvent.contextMenu(screen.getByText("zobacz"));
    await user.click(screen.getByRole("menuitem", { name: "Pobierz" }));

    expect(click.mock.instances[0]).toHaveAttribute("href", "/media/cat.png");
    expect(click.mock.instances[0]).toHaveAttribute("download", "cat.png");
  });

  it("offers a picture's address next to saving it", () => {
    setup({ bodies: [picture] });

    fireEvent.contextMenu(screen.getByRole("img", { name: "cat.png" }));

    expect(menuItem("Kopiuj adres obrazu")).not.toBeNull();
  });

  it("offers a file to save but not an image's address", () => {
    setup({
      bodies: [
        {
          id: "m-file",
          parts: [{ kind: "file", name: "notatki.pdf", ext: "pdf", size: "1 MB", url: "/files/n.pdf" }],
        },
      ],
    });

    fireEvent.contextMenu(screen.getByText("notatki.pdf"));

    expect(menuItem("Pobierz")).not.toBeNull();
    expect(menuItem("Kopiuj adres obrazu")).toBeNull();
  });
});

describe("MessageGroup editing", () => {
  const field = () => screen.getByRole("textbox", { name: "Edytuj wiadomość" });

  it("does not save on the Enter that closes an IME candidate list", () => {
    const onEditSave = vi.fn();
    setup({ editing: { id: "m-1", original: "pierwsza" }, onEditSave });

    fireEvent.change(field(), { target: { value: "pierwsza zmiana" } });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });

    expect(onEditSave).not.toHaveBeenCalled();
  });

  it("locks the field while the save is on its way", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn(() => new Promise<void>(() => undefined));
    setup({ editing: { id: "m-1", original: "stare" }, onEditSave });

    await user.type(field(), " nowe{Enter}");

    expect(field()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("lets the text be saved again after a failure", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn().mockRejectedValueOnce(new Error("offline"));
    setup({ editing: { id: "m-1", original: "stare" }, onEditSave });

    await user.type(field(), " nowe{Enter}");
    await screen.findByRole("alert");
    expect(field()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(onEditSave).toHaveBeenCalledTimes(2);
    expect(onEditSave).toHaveBeenLastCalledWith("m-1", "stare nowe");
  });

  it("saves the trimmed text", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    setup({ editing: { id: "m-1", original: "stare" }, onEditSave });

    await user.type(field(), "  nowe  {Enter}");

    expect(onEditSave).toHaveBeenCalledExactlyOnceWith("m-1", "stare  nowe");
  });

  it("cancels from the button without saving", async () => {
    const user = userEvent.setup();
    const onEditSave = vi.fn();
    const onEditCancel = vi.fn();
    setup({ editing: { id: "m-1", original: "stare" }, onEditSave, onEditCancel });

    await user.type(field(), " nowe");
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(onEditCancel).toHaveBeenCalledOnce();
    expect(onEditSave).not.toHaveBeenCalled();
  });
});
