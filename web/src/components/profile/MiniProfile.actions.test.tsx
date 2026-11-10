import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProfileRelation, ProfileVM } from "@/components/view-models";

import { MiniProfile, type MiniProfileProps } from "./MiniProfile";

function setup(
  relation: ProfileRelation,
  overrides: Partial<MiniProfileProps> = {},
) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const profile: ProfileVM = {
    person: {
      id: "u-ada-8",
      displayName: "Ada",
      initials: "AD",
      presence: "online",
    },
    username: "ada",
    relation,
    roles: [],
  };
  const props: MiniProfileProps = {
    profile,
    anchor,
    onClose: vi.fn(),
    onMessage: vi.fn(),
    onAddFriend: vi.fn(),
    onUnblock: vi.fn(),
    onEditProfile: vi.fn(),
    onAcceptRequest: vi.fn(),
    onDeclineRequest: vi.fn(),
    onCancelRequest: vi.fn(),
    ...overrides,
  };
  const { rerender } = render(<MiniProfile {...props} />);
  return {
    ...props,
    /** The same open card, its profile now in another relation. */
    changeRelation: (next: ProfileRelation) =>
      rerender(<MiniProfile {...props} profile={{ ...profile, relation: next }} />),
  };
}

/** The round controls over the banner, whatever they are called. */
function toolNames(): string[] {
  return Array.from(document.querySelectorAll(".mp-tool")).map(
    (tool) => tool.getAttribute("aria-label") ?? "",
  );
}

describe("MiniProfile relationship controls", () => {
  it("lets you edit your own profile, and not write to yourself", async () => {
    const user = userEvent.setup();
    const { onEditProfile } = setup("self");

    expect(toolNames()).toEqual(["Edytuj swój profil"]);
    expect(screen.queryByLabelText("Napisz do Ada")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edytuj swój profil" }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });

  it("offers nothing over the banner for a friend, but a field to write in", () => {
    setup("friend");

    expect(toolNames()).toEqual([]);
    expect(screen.getByLabelText("Napisz do Ada")).toBeInTheDocument();
  });

  it("sends the invitation when asked", async () => {
    const user = userEvent.setup();
    const { onAddFriend } = setup("none");

    await user.click(
      screen.getByRole("button", { name: "Wyślij zaproszenie do Ada" }),
    );

    expect(onAddFriend).toHaveBeenCalledOnce();
  });

  it("lets you withdraw an invitation and says it is waiting", async () => {
    const user = userEvent.setup();
    const { onCancelRequest } = setup("outgoing");

    expect(screen.getByText("Zaproszenie czeka na odpowiedź.")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Anuluj zaproszenie do Ada" }),
    );

    expect(onCancelRequest).toHaveBeenCalledOnce();
  });

  it("unblocks, and explains what a block does", async () => {
    const user = userEvent.setup();
    const { onUnblock } = setup("blocked");

    expect(
      screen.getByText("Zablokowany — nie widzi Twoich wiadomości."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Odblokuj Ada" }));

    expect(onUnblock).toHaveBeenCalledOnce();
  });
});

describe("MiniProfile message field", () => {
  it("sends with the button and trims what was typed", async () => {
    const user = userEvent.setup();
    const { onMessage } = setup("friend");

    await user.type(screen.getByLabelText("Napisz do Ada"), "  hej  ");
    await user.click(screen.getByRole("button", { name: "Wyślij wiadomość do Ada" }));

    expect(onMessage).toHaveBeenCalledExactlyOnceWith("hej");
    expect(screen.getByLabelText("Napisz do Ada")).toHaveValue("");
  });

  it("will not send an empty or blank message", async () => {
    const user = userEvent.setup();
    const { onMessage } = setup("friend");
    const send = screen.getByRole("button", { name: "Wyślij wiadomość do Ada" });

    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Napisz do Ada"), "   {Enter}");

    expect(send).toBeDisabled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("keeps an unsent draft while a block takes the field away", async () => {
    const user = userEvent.setup();
    const { changeRelation } = setup("friend");

    await user.type(screen.getByLabelText("Napisz do Ada"), "half a thought");
    changeRelation("blocked");
    expect(screen.queryByLabelText("Napisz do Ada")).not.toBeInTheDocument();
    changeRelation("friend");

    expect(screen.getByLabelText("Napisz do Ada")).toHaveValue("half a thought");
  });

  it("addresses the placeholder to the username", () => {
    setup("friend");

    expect(screen.getByPlaceholderText("Napisz do @ada")).toBeInTheDocument();
  });
});
