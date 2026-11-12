import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DmConversation } from "@/ports";
import { resetStubs, setStubs, stubs } from "@/test/hookStubs";

import { DmRailContainer } from "./DmRailContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/hookStubs")).hooksModule);

const SELF = "u-maja";

function conversation(
  id: string,
  name: string,
  overrides: Partial<DmConversation> = {},
): DmConversation {
  return {
    id,
    peer: { id: `u-${id}`, username: id, displayName: name, presence: "online" },
    unread: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function message(authorId: string, content: string): DmConversation["lastMessage"] {
  return {
    id: `m-${authorId}`,
    author: { id: authorId },
    content,
  } as DmConversation["lastMessage"];
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: "b" }).closest<HTMLElement>(".dm-item");
  if (row === null) throw new Error(`no conversation row for ${name}`);
  return row;
}

function setConversations(conversations: DmConversation[]) {
  setStubs({ friends: { conversations } });
}

beforeEach(resetStubs);

describe("DmRailContainer", () => {
  it("invites the first message into an empty conversation", () => {
    setConversations([conversation("ola", "Ola")]);
    render(<DmRailContainer />);

    expect(within(rowOf("Ola")).getByText("Napisz pierwszą wiadomość")).toBeInTheDocument();
  });

  it("flattens the last message onto one line and credits you for your own", () => {
    setConversations([
      conversation("ola", "Ola", { lastMessage: message("u-ola", "dobra\n\n  wiadomość") }),
      conversation("kuba", "Kuba", { lastMessage: message(SELF, "no to jedziemy") }),
    ]);
    render(<DmRailContainer />);

    expect(within(rowOf("Ola")).getByText("dobra wiadomość")).toBeInTheDocument();
    expect(within(rowOf("Kuba")).getByText("Ty: no to jedziemy")).toBeInTheDocument();
  });

  it("names an attachment when the last message has no text", () => {
    setConversations([
      conversation("ola", "Ola", { lastMessage: message("u-ola", "   ") }),
    ]);
    render(<DmRailContainer />);

    expect(within(rowOf("Ola")).getByText("Załącznik")).toBeInTheDocument();
  });

  it("offers to join a conversation that has a call going", () => {
    setConversations([
      conversation("ola", "Ola", {
        lastMessage: message("u-ola", "cześć"),
        callParticipants: [{ userId: "u-ola" } as never],
      }),
    ]);
    render(<DmRailContainer />);

    expect(
      within(rowOf("Ola")).getByText("Trwa rozmowa. Kliknij, aby dołączyć"),
    ).toBeInTheDocument();
  });

  it("opens a conversation, and the friends view on its add tab", async () => {
    setConversations([conversation("ola", "Ola")]);
    const user = userEvent.setup();
    render(<DmRailContainer />);

    await user.click(within(rowOf("Ola")).getByRole("button"));
    expect(stubs.ui.openDm).toHaveBeenCalledWith("ola");

    await user.click(screen.getByRole("button", { name: "Dodaj znajomego" }));
    expect(stubs.ui.setFriendsTab).toHaveBeenCalledWith("add");
    expect(stubs.ui.openFriends).toHaveBeenCalled();
  });
});
