import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmojiPicker } from "@/components/room/EmojiPicker";
import { MessageEditor } from "@/components/room/MessageEditor";
import { EmojiPane } from "@/components/settings/panes/EmojiPane";
import { AppShell } from "@/components/shell/AppShell";
import { polish } from "@/test/translators";

import { AnchoredCard } from "./AnchoredCard";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { Dropdown } from "./Dropdown";
import { Modal } from "./Modal";
import { Popover } from "./Popover";

/*
 * What happens when overlays are open on top of one another, as it is. Every
 * overlay here listens for Escape and for a press elsewhere by itself, so a
 * nesting that closes two things at once is pinned as such: the tests record
 * today's behaviour, they do not argue for it.
 */

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

/** A dialog like the settings dialogs: open until it is closed, reporting each close. */
function Dialog({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      labelledBy="settings-title"
      className="sv-wrap"
    >
      <h2 id="settings-title">Settings</h2>
      <button type="button">Inside</button>
      {children}
    </Modal>
  );
}

const settings = () => screen.queryByRole("dialog", { name: "Settings" });

describe("a confirm dialog over a settings dialog", () => {
  function Asking({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
    const confirm = useConfirm();
    return (
      <button
        type="button"
        onClick={() => void confirm({ title: "Delete?", confirmLabel: "Yes" }).then(onAnswer)}
      >
        Delete
      </button>
    );
  }

  async function raiseConfirm() {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onAnswer = vi.fn();
    render(
      <ConfirmProvider>
        <Dialog onClose={onClose}>
          <Asking onAnswer={onAnswer} />
        </Dialog>
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete?" });
    return { user, onClose, onAnswer };
  }

  it("is closed by Escape together with the dialog beneath it", async () => {
    const { user, onClose, onAnswer } = await raiseConfirm();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete?" })).toBeNull());
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(settings()).toBeNull();
  });

  it("is closed by a press on its backdrop alone", async () => {
    const { user, onClose, onAnswer } = await raiseConfirm();

    await user.click(screen.getByRole("dialog", { name: "Delete?" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete?" })).toBeNull());
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(settings()).not.toBeNull();
  });

  it("is closed by its Cancel button alone", async () => {
    const { user, onClose, onAnswer } = await raiseConfirm();

    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete?" })).toBeNull());
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does the same when a settings pane raised the question", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConfirmProvider>
        <Dialog onClose={onClose}>
          <EmojiPane
            supported
            emoji={[{ id: "e-1", shortcode: ":mushris:", glyph: "/api/emoji/e-1/image" }]}
            onUpload={vi.fn()}
            onDelete={onDelete}
          />
        </Dialog>
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Usuń emoji :mushris:" }));
    await screen.findByRole("dialog", { name: /mushris/ });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /mushris/ })).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(settings()).toBeNull();
  });
});

describe("a context menu over a dialog", () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [menu, setMenu] = useState(false);
    return (
      <Dialog onClose={onClose}>
        <button type="button" onClick={() => setMenu(true)}>
          Menu
        </button>
        {menu ? (
          <ContextMenu
            at={{ x: 5, y: 5 }}
            label="Actions"
            entries={[{ id: "a", label: "Alpha", onSelect: vi.fn() }]}
            onClose={() => setMenu(false)}
          />
        ) : null}
      </Dialog>
    );
  }

  async function openMenu() {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menu", { name: "Actions" })).toHaveFocus();
    return { user, onClose };
  }

  it("is closed by Escape alone", async () => {
    const { user, onClose } = await openMenu();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(settings()).not.toBeNull();
  });

  it("is closed by a press elsewhere in the dialog alone", async () => {
    const { user, onClose } = await openMenu();

    await user.click(screen.getByRole("button", { name: "Inside" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is closed by a press on the backdrop, and the click that ends it closes the dialog too", async () => {
    const { user, onClose } = await openMenu();

    await user.click(settings()!);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves the dialog open when a press lands inside the menu", async () => {
    const { user, onClose } = await openMenu();

    await user.click(screen.getByRole("menuitem", { name: "Alpha" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a dropdown inside a dialog", () => {
  async function openList() {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog onClose={onClose}>
        <Dropdown options={OPTIONS} value="a" onChange={vi.fn()} label="Letter" />
      </Dialog>,
    );
    await user.click(screen.getByRole("combobox", { name: "Letter" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    return { user, onClose };
  }

  it("is closed by Escape alone, and the next Escape closes the dialog", async () => {
    const { user, onClose } = await openList();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(settings()).toBeNull();
  });

  it("is closed by a press elsewhere in the dialog alone", async () => {
    const { user, onClose } = await openList();

    await user.click(screen.getByRole("button", { name: "Inside" }));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is closed by a press on the backdrop, and the click that ends it closes the dialog too", async () => {
    const { user, onClose } = await openList();

    await user.click(settings()!);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves the dialog open when an option is chosen", async () => {
    const { user, onClose } = await openList();

    await user.click(screen.getByRole("option", { name: /Beta/ }));

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the shell's window-level Escape handler", () => {
  beforeEach(() => {
    window.innerWidth = 600;
  });
  afterEach(() => {
    window.innerWidth = 1024;
  });

  /** The shell with both drawers open, and the spies that hear them close. */
  function renderShell(room?: ReactNode) {
    const onRail = vi.fn();
    const onRoster = vi.fn();
    render(
      <AppShell
        serverRail={<nav>Servers</nav>}
        rail={<nav>Channels</nav>}
        room={<main>{room}</main>}
        roster={<aside>People</aside>}
        railOpen
        onRailOpenChange={onRail}
        rosterOpen
        onRosterOpenChange={onRoster}
      />,
    );
    return { onRail, onRoster };
  }

  function PopoverInRoom() {
    const [open, setOpen] = useState(false);
    return (
      <Popover
        open={open}
        onOpenChange={setOpen}
        renderTrigger={(props) => (
          <button {...props} type="button">
            Account
          </button>
        )}
      >
        <button type="button">Sign out</button>
      </Popover>
    );
  }

  function CardInRoom() {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <>
        <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>
          Maja
        </button>
        {anchor === null ? null : (
          <AnchoredCard anchor={anchor} label="Profile" onClose={() => setAnchor(null)}>
            <button type="button">Message</button>
          </AnchoredCard>
        )}
      </>
    );
  }

  it("acts on Escape when nothing is open", async () => {
    const user = userEvent.setup();
    const { onRail, onRoster } = renderShell();

    await user.keyboard("{Escape}");

    expect(onRail).toHaveBeenCalledWith(false);
    expect(onRoster).toHaveBeenCalledWith(false);
  });

  it("leaves Escape to a popover in the room, and acts on the next one", async () => {
    const user = userEvent.setup();
    const { onRail, onRoster } = renderShell(<PopoverInRoom />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute("aria-expanded", "false");
    expect(onRail).not.toHaveBeenCalled();
    expect(onRoster).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onRail).toHaveBeenCalledWith(false);
    expect(onRoster).toHaveBeenCalledWith(false);
  });

  it("leaves Escape to an anchored card in the room, and acts on the next one", async () => {
    const user = userEvent.setup();
    const { onRail } = renderShell(<CardInRoom />);
    await user.click(screen.getByRole("button", { name: "Maja" }));
    expect(screen.getByRole("button", { name: "Message" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Profile" })).toBeNull();
    expect(onRail).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onRail).toHaveBeenCalledWith(false);
  });

  it("leaves Escape to a context menu in the room", async () => {
    const user = userEvent.setup();
    function MenuInRoom() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Menu
          </button>
          {open ? (
            <ContextMenu
              at={{ x: 5, y: 5 }}
              label="Actions"
              entries={[{ id: "a", label: "Alpha", onSelect: vi.fn() }]}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }
    const { onRail } = renderShell(<MenuInRoom />);
    await user.click(screen.getByRole("button", { name: "Menu" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onRail).not.toHaveBeenCalled();
  });

  it("leaves Escape to a dropdown in the room", async () => {
    const user = userEvent.setup();
    const { onRail } = renderShell(
      <Dropdown options={OPTIONS} value="a" onChange={vi.fn()} label="Letter" />,
    );
    await user.click(screen.getByRole("combobox", { name: "Letter" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onRail).not.toHaveBeenCalled();
  });
});

describe("a window-level Escape handler beside a dialog", () => {
  function listenOnWindow() {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    return { onWindowKey, stop: () => window.removeEventListener("keydown", onWindowKey) };
  }

  it("hears Escape when no overlay is open", async () => {
    const user = userEvent.setup();
    const { onWindowKey, stop } = listenOnWindow();
    try {
      render(<button type="button">Page</button>);

      await user.keyboard("{Escape}");

      expect(onWindowKey).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it("does not hear the Escape that closes a confirm dialog over a dialog", async () => {
    const user = userEvent.setup();
    const { onWindowKey, stop } = listenOnWindow();
    try {
      function Asking() {
        const confirm = useConfirm();
        return (
          <button type="button" onClick={() => void confirm({ title: "Delete?" })}>
            Delete
          </button>
        );
      }
      render(
        <ConfirmProvider>
          <Dialog onClose={vi.fn()}>
            <Asking />
          </Dialog>
        </ConfirmProvider>,
      );
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await screen.findByRole("dialog", { name: "Delete?" });
      onWindowKey.mockClear();

      await user.keyboard("{Escape}");

      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

describe("an anchored card over a dialog", () => {
  function CardInDialog({
    onClose,
    children,
  }: {
    onClose: () => void;
    children: (closeCard: () => void) => ReactNode;
  }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <Dialog onClose={onClose}>
        <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>
          Pick
        </button>
        {anchor === null ? null : (
          <AnchoredCard anchor={anchor} label="Card" onClose={() => setAnchor(null)}>
            {children(() => setAnchor(null))}
          </AnchoredCard>
        )}
      </Dialog>
    );
  }

  it("is closed together with the dialog by Escape when focus is on a plain control in it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CardInDialog onClose={onClose}>{() => <button type="button">In card</button>}</CardInDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByRole("button", { name: "In card" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is closed alone by Escape in the search field of the emoji picker inside it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CardInDialog onClose={onClose}>
        {(closeCard) => <EmojiPicker onPick={vi.fn()} onClose={closeCard} />}
      </CardInDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByRole("textbox", { name: "Szukaj emoji" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(settings()).not.toBeNull();
  });

  it("is closed together with the dialog by Escape on a cell of the emoji picker inside it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CardInDialog onClose={onClose}>{() => <EmojiPicker onPick={vi.fn()} />}</CardInDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Pick" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0]).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is closed by a press on a control of the dialog beneath, which stays open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CardInDialog onClose={onClose}>{() => <button type="button">In card</button>}</CardInDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Pick" }));

    await user.click(screen.getByRole("button", { name: "Inside" }));

    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("two outside-dismissed panels, one raised from the other", () => {
  function CardFromPopover({ onInside }: { onInside?: () => void }) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <>
        <button type="button">Elsewhere</button>
        <Popover
          open={open}
          onOpenChange={setOpen}
          renderTrigger={(props) => (
            <button {...props} type="button">
              Account
            </button>
          )}
        >
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>
            Emoji
          </button>
        </Popover>
        {anchor === null ? null : (
          <AnchoredCard anchor={anchor} label="Card" onClose={() => setAnchor(null)}>
            <button type="button" onClick={onInside}>
              In card
            </button>
          </AnchoredCard>
        )}
      </>
    );
  }

  async function raiseCard() {
    const user = userEvent.setup();
    render(<CardFromPopover />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    expect(screen.getByRole("dialog", { name: "Card" })).toBeInTheDocument();
    return user;
  }

  const popoverOpen = () =>
    screen.getByRole("button", { name: "Account" }).getAttribute("aria-expanded") === "true";

  it("both close on Escape", async () => {
    const user = await raiseCard();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
    expect(popoverOpen()).toBe(false);
  });

  it("both close on a press elsewhere", async () => {
    const user = await raiseCard();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("dialog", { name: "Card" })).toBeNull();
    expect(popoverOpen()).toBe(false);
  });

  it("the popover counts a press inside the card as a press elsewhere", async () => {
    const user = await raiseCard();

    await user.click(screen.getByRole("button", { name: "In card" }));

    expect(screen.getByRole("dialog", { name: "Card" })).toBeInTheDocument();
    expect(popoverOpen()).toBe(false);
  });
});

describe("an inline Escape consumer inside a dialog", () => {
  it("cancels an edit without closing the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(
      <Dialog onClose={onClose}>
        <MessageEditor original="Hello" onSave={vi.fn()} onCancel={onCancel} t={polish} />
      </Dialog>,
    );
    const field = screen.getByRole("textbox", { name: polish("message.edit.label") });
    field.focus();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(settings()).not.toBeNull();
  });

  it("leaves Escape to the dialog once focus is elsewhere in it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(
      <Dialog onClose={onClose}>
        <MessageEditor original="Hello" onSave={vi.fn()} onCancel={onCancel} t={polish} />
      </Dialog>,
    );
    screen.getByRole("button", { name: "Inside" }).focus();

    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("a context menu over an anchored card", () => {
  it("is closed by Escape alone when it holds the focus", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const [menu, setMenu] = useState(false);
      return (
        <>
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>
            Maja
          </button>
          {anchor === null ? null : (
            <AnchoredCard anchor={anchor} label="Card" onClose={() => setAnchor(null)}>
              <button type="button" onClick={() => setMenu(true)}>
                More
              </button>
            </AnchoredCard>
          )}
          {menu ? (
            <ContextMenu
              at={{ x: 5, y: 5 }}
              label="Actions"
              entries={[{ id: "a", label: "Alpha", onSelect: vi.fn() }]}
              onClose={() => setMenu(false)}
            />
          ) : null}
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Maja" }));
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu", { name: "Actions" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Card" })).toBeInTheDocument();
  });
});
