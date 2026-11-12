import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";
import type {
  FriendRequestVM,
  FriendsTab,
  FriendVM,
  PersonVM,
} from "@/components/view-models";
import type { AddFriendResult } from "@/ports";

import { FriendsView, type FriendsViewProps } from "./FriendsView";

function person(id: string, displayName: string, presence: PersonVM["presence"]): PersonVM {
  return { id, displayName, initials: displayName.slice(0, 2).toUpperCase(), presence };
}

const kasia: FriendVM = {
  person: person("u1", "Kasia", "online"),
  username: "kasia",
  since: "3 marca 2026",
};
const tomek: FriendVM = { person: person("u2", "Tomek", "offline"), username: "tomek.w" };
const ada: FriendVM = { person: person("u3", "Ada", "idle"), username: "ada" };

const incoming: FriendRequestVM = {
  id: "r1",
  person: person("u4", "Basia", "online"),
  username: "basia",
  direction: "incoming",
  when: "Wysłano 3 dni temu",
};
const outgoing: FriendRequestVM = {
  id: "r2",
  person: person("u5", "Olek", "offline"),
  username: "olek",
  direction: "outgoing",
  when: "Wysłano wczoraj",
};

type Overrides = Partial<FriendsViewProps> & { initialTab?: FriendsTab };

/** The view is controlled; this is the part of the app that holds its tab. */
function Harness({ spies, initialTab }: { spies: FriendsViewProps; initialTab: FriendsTab }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <ConfirmProvider>
      <FriendsView
        {...spies}
        tab={tab}
        onTabChange={(next) => {
          spies.onTabChange(next);
          setTab(next);
        }}
      />
    </ConfirmProvider>
  );
}

function view({ initialTab = "all", ...overrides }: Overrides = {}) {
  const spies: FriendsViewProps = {
    tab: "all",
    onTabChange: vi.fn(),
    friends: [kasia, tomek, ada],
    requests: [],
    blocked: [],
    railOpen: false,
    onToggleRail: vi.fn(),
    onMessage: vi.fn(),
    onCall: vi.fn(),
    onRemove: vi.fn(),
    onBlock: vi.fn(),
    onUnblock: vi.fn(),
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    onCancel: vi.fn(),
    onAddFriend: vi.fn().mockResolvedValue("sent" as AddFriendResult),
    onOpenProfile: vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  render(<Harness spies={spies} initialTab={initialTab} />);
  return { user, spies };
}

afterEach(() => {
  window.innerWidth = 1024;
});

describe("FriendsView tabs", () => {
  it("moves and selects with the arrow keys, wrapping at both ends", async () => {
    const { user, spies } = view({ initialTab: "online" });

    screen.getByRole("tab", { name: "W sieci" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Wszyscy" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Wszyscy" })).toHaveAttribute("aria-selected", "true");
    expect(spies.onTabChange).toHaveBeenLastCalledWith("all");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Zablokowani" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "W sieci" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Zablokowani" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "W sieci" })).toHaveFocus();
    expect(spies.onTabChange).toHaveBeenLastCalledWith("online");
  });

  it("keeps only the selected tab in the tab order, and the first one while adding", async () => {
    const { user } = view({ initialTab: "pending" });

    expect(screen.getByRole("tab", { name: "Oczekujące" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Wszyscy" })).toHaveAttribute("tabindex", "-1");

    // The empty pending list offers the same button; the header's comes first.
    await user.click(screen.getAllByRole("button", { name: "Dodaj znajomego" })[0]!);
    expect(screen.getByRole("button", { name: "Dodaj znajomego" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-selected", "false");
    }
    expect(screen.getByRole("tab", { name: "W sieci" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).not.toHaveAttribute("aria-labelledby");
  });

  it("badges the pending tab with incoming requests only", () => {
    view({ requests: [incoming, outgoing] });

    expect(within(screen.getByRole("tab", { name: /Oczekujące/ })).getByText("1")).toBeTruthy();
  });

  it("names the selected tab as the label of the panel", () => {
    view({ initialTab: "blocked" });

    expect(screen.getByRole("tabpanel", { name: "Zablokowani" })).toBeTruthy();
  });
});

describe("FriendsView lists", () => {
  it("lists only people who are not offline under 'W sieci'", () => {
    view({ initialTab: "online" });

    expect(screen.getByText("Kasia")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByText("Tomek")).toBeNull();
  });

  it("says since when a friend is a friend, and falls back to the presence word", () => {
    view();

    expect(screen.getByText("Znajomi od 3 marca 2026")).toBeTruthy();
    expect(screen.getByText("Poza siecią")).toBeTruthy();
    expect(screen.getByText("Zaraz wracam")).toBeTruthy();
  });

  it("finds people by display name or by username, ignoring case", async () => {
    const { user } = view();
    const search = screen.getByRole("searchbox", { name: "Szukaj wśród znajomych" });

    await user.type(search, "TOMEK.W");
    expect(screen.getByText("Tomek")).toBeTruthy();
    expect(screen.queryByText("Kasia")).toBeNull();

    await user.clear(search);
    await user.type(search, "ada");
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByText("Tomek")).toBeNull();
  });

  it("keeps the search when moving to another list", async () => {
    const { user } = view();

    await user.type(screen.getByRole("searchbox"), "ka");
    await user.click(screen.getByRole("tab", { name: "W sieci" }));

    expect(screen.getByRole("searchbox")).toHaveValue("ka");
    expect(screen.getByText("Kasia")).toBeTruthy();
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("blames the search on the online list and quotes it", async () => {
    const { user } = view({ initialTab: "online" });

    await user.type(screen.getByRole("searchbox"), "  tomek ");

    expect(screen.getByText("Nikt w sieci nie pasuje do „tomek”.")).toBeTruthy();
  });

  it("tells an empty online list from having no friends at all", () => {
    view({ initialTab: "online", friends: [tomek] });

    expect(screen.getByText("Nikogo teraz nie ma")).toBeTruthy();
  });

  it("offers the empty pending list a way to add somebody", async () => {
    const { user, spies } = view({ initialTab: "pending" });

    expect(screen.getByText("Nic nie czeka")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Dodaj znajomego" })[1]!);
    expect(spies.onTabChange).toHaveBeenLastCalledWith("add");
  });
});

describe("FriendsView rows", () => {
  it("opens the card of the person, anchored to the row's button", async () => {
    const { user, spies } = view();

    await user.click(screen.getByText("Kasia"));

    expect(spies.onOpenProfile).toHaveBeenCalledWith("u1", expect.any(HTMLElement));
    const anchor = vi.mocked(spies.onOpenProfile).mock.calls[0]![1];
    expect(anchor.tagName).toBe("BUTTON");
  });

  it("writes and calls from the row itself", async () => {
    const { user, spies } = view();

    await user.click(screen.getByRole("button", { name: "Napisz do Kasia" }));
    await user.click(screen.getByRole("button", { name: "Zadzwoń Kasia" }));

    expect(spies.onMessage).toHaveBeenCalledWith("u1");
    expect(spies.onCall).toHaveBeenCalledWith("u1");
  });

  it("asks before blocking, and does nothing when the answer is no", async () => {
    const { user, spies } = view();

    await user.click(screen.getByRole("button", { name: "Więcej działań: Kasia" }));
    await user.click(screen.getByRole("button", { name: "Zablokuj" }));
    expect(screen.getByRole("heading", { name: "Zablokować Kasia?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(spies.onBlock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Zablokować Kasia?" })).toBeNull(),
    );
  });

  it("blocks once the question is answered yes", async () => {
    const { user, spies } = view();

    await user.click(screen.getByRole("button", { name: "Więcej działań: Kasia" }));
    await user.click(screen.getByRole("button", { name: "Zablokuj" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Zablokuj" }));

    expect(spies.onBlock).toHaveBeenCalledWith("u1");
  });

  it("keeps the call out of the menu on a wide screen", async () => {
    const { user } = view();

    await user.click(screen.getByRole("button", { name: "Więcej działań: Kasia" }));

    const menu = screen.getByRole("dialog", { name: "Więcej działań: Kasia" });
    expect(within(menu).queryByRole("button", { name: "Zadzwoń" })).toBeNull();
  });

  it("moves the call into the menu on a phone and closes the menu behind it", async () => {
    window.innerWidth = 500;
    const { user, spies } = view();

    const trigger = screen.getByRole("button", { name: "Więcej działań: Kasia" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Zadzwoń" }));

    expect(spies.onCall).toHaveBeenCalledWith("u1");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the menu when the trigger is pressed a second time", async () => {
    const { user } = view();

    const trigger = screen.getByRole("button", { name: "Więcej działań: Kasia" });
    await user.click(trigger);
    await user.click(trigger);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FriendsView requests and blocks", () => {
  it("answers an incoming request either way and withdraws an outgoing one", async () => {
    const { user, spies } = view({ initialTab: "pending", requests: [incoming, outgoing] });

    expect(screen.getByText("Zaproszenie przychodzące · Wysłano 3 dni temu")).toBeTruthy();
    expect(screen.getByText("Zaproszenie wysłane · Wysłano wczoraj")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Przyjmij zaproszenie od Basia" }));
    await user.click(screen.getByRole("button", { name: "Odrzuć zaproszenie od Basia" }));
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(spies.onAccept).toHaveBeenCalledWith("r1");
    expect(spies.onDecline).toHaveBeenCalledWith("r1");
    expect(spies.onCancel).toHaveBeenCalledWith("r2");
    expect(screen.queryByRole("button", { name: /Przyjmij zaproszenie od Olek/ })).toBeNull();
  });

  it("lists the blocked with the way to undo it", async () => {
    const { user, spies } = view({
      initialTab: "blocked",
      blocked: [{ person: person("u6", "Zenek", "offline"), username: "zenek" }],
    });

    expect(screen.getByText("Zablokowany (nie widzi Twoich wiadomości)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Odblokuj" }));

    expect(spies.onUnblock).toHaveBeenCalledWith("u6");
  });

  it("finds a blocked person by username", async () => {
    const { user } = view({
      initialTab: "blocked",
      blocked: [{ person: person("u6", "Zenek", "offline"), username: "zenek" }],
    });

    await user.type(screen.getByRole("searchbox"), "nie ma");

    expect(screen.getByText("Nikt z zablokowanych nie pasuje do „nie ma”.")).toBeTruthy();
  });
});

describe("FriendsView add form", () => {
  async function openForm(overrides: Overrides = {}) {
    const rig = view(overrides);
    await rig.user.click(screen.getByRole("button", { name: "Dodaj znajomego" }));
    return { ...rig, field: screen.getByRole("textbox", { name: "Nazwa użytkownika" }) };
  }

  it("cannot send an empty name", async () => {
    const { user, field, spies } = await openForm();
    const send = screen.getByRole("button", { name: "Wyślij zaproszenie" });

    expect(send).toBeDisabled();
    await user.type(field, "   ");
    expect(send).toBeDisabled();
    expect(spies.onAddFriend).not.toHaveBeenCalled();
  });

  it("sends the trimmed name, confirms politely and empties the field", async () => {
    const { user, field, spies } = await openForm();

    await user.type(field, " @ada ");
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));

    expect(spies.onAddFriend).toHaveBeenCalledWith("@ada");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Zaproszenie do @ada zostało wysłane.",
    );
    expect(field).toHaveValue("");
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("submits with Enter", async () => {
    const { user, field, spies } = await openForm();

    await user.type(field, "ada{Enter}");

    expect(spies.onAddFriend).toHaveBeenCalledWith("ada");
  });

  it.each<[AddFriendResult, RegExp]>([
    ["unknown-user", /Nie znaleziono nikogo o nazwie @ada\./],
    ["already-friends", /@ada jest już na Twojej liście znajomych\./],
    ["already-sent", /Zaproszenie do @ada już czeka na odpowiedź\./],
    ["self", /To Twoja własna nazwa użytkownika\./],
    ["blocked", /@ada jest zablokowany\./],
  ])("explains a refusal (%s) as an alert and keeps the name", async (result, sentence) => {
    const { user, field } = await openForm({
      onAddFriend: vi.fn().mockResolvedValue(result),
    });

    await user.type(field, "ada");
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
    expect(field).toHaveValue("ada");
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("drops the answer as soon as the name is edited", async () => {
    const { user, field } = await openForm({
      onAddFriend: vi.fn().mockResolvedValue("unknown-user"),
    });

    await user.type(field, "ada");
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await screen.findByRole("alert");
    await user.type(field, "m");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("sends once while the first answer is still on its way", async () => {
    let answer: (result: AddFriendResult) => void = () => {};
    const onAddFriend = vi.fn(
      () => new Promise<AddFriendResult>((resolve) => (answer = resolve)),
    );
    const { user, field } = await openForm({ onAddFriend });

    await user.type(field, "ada");
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    expect(screen.getByRole("button", { name: "Wyślij zaproszenie" })).toBeDisabled();
    await user.type(field, "{Enter}");

    expect(onAddFriend).toHaveBeenCalledTimes(1);
    answer("sent");
    await screen.findByRole("status");
    expect(screen.getByRole("button", { name: "Wyślij zaproszenie" })).toBeDisabled();
  });

  it("is still holding the name and the answer after a visit to another list", async () => {
    const { user, field } = await openForm({
      onAddFriend: vi.fn().mockResolvedValue("unknown-user"),
    });

    await user.type(field, "ada");
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("tab", { name: "W sieci" }));
    await user.click(screen.getByRole("button", { name: "Dodaj znajomego" }));

    expect(screen.getByRole("textbox", { name: "Nazwa użytkownika" })).toHaveValue("ada");
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
