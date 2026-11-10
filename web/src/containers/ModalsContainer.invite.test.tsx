import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import type { Invite, Presence } from "@/ports";
import { NONE_SUPPORTED, fakeAdminPort } from "@/test/adminPort";
import { harness, resetHarness } from "@/test/modalsHarness";

import { ModalsContainer } from "./ModalsContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translateMessage("pl", key, values);

const INVITE: Invite = {
  id: "inv-1",
  url: "https://chat.example/invite/abc123",
  createdByName: "Maja",
  uses: 0,
  maxUses: null,
  expiresAt: null,
};

function friend(id: string, displayName: string, presence: Presence = "online") {
  return {
    user: { id, username: id, displayName, presence },
    since: "2026-01-01T00:00:00.000Z",
  } as unknown as (typeof harness.friends.friends)[number];
}

function openInvite() {
  harness.ui.modal = "invite";
  render(<ModalsContainer />);
}

beforeEach(resetHarness);

describe("ModalsContainer: invite", () => {
  it("stays shut for somebody who cannot manage the server", () => {
    harness.directory.canManageServer = false;

    openInvite();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(harness.ports.admin.listInvites).not.toHaveBeenCalled();
  });

  it("offers the link the server already has", async () => {
    harness.ports.admin = fakeAdminPort({ listInvites: vi.fn(async () => [INVITE]) });

    openInvite();

    expect(await screen.findByText(INVITE.url)).toBeVisible();
  });

  it("puts a created invite in the dialog", async () => {
    const user = userEvent.setup();
    let invites: Invite[] = [];
    harness.ports.admin = fakeAdminPort({
      listInvites: vi.fn(async () => invites),
      createInvite: vi.fn(async () => {
        invites = [INVITE];
        return INVITE;
      }),
    });
    openInvite();

    await user.click(await screen.findByRole("button", { name: t("settings.newInvite") }));

    expect(await screen.findByText(INVITE.url)).toBeVisible();
  });

  it("says so when the link cannot be created", async () => {
    const user = userEvent.setup();
    harness.ports.admin = fakeAdminPort({
      createInvite: vi.fn(async () => {
        throw new ApiError("server", "boom", 500);
      }),
    });
    openInvite();

    await user.click(await screen.findByRole("button", { name: t("settings.newInvite") }));

    expect(await screen.findByRole("alert")).toHaveTextContent(t("invite.createFailed"));
  });

  it("cannot create a link where the server has no invites", async () => {
    harness.ports.admin = fakeAdminPort({ supported: { ...NONE_SUPPORTED } });

    openInvite();

    expect(await screen.findByText(t("invite.noLink"))).toBeVisible();
    expect(screen.queryByRole("button", { name: t("settings.newInvite") })).not.toBeInTheDocument();
  });

  it("lists friends who are not members first, then members marked as such", async () => {
    harness.friends.friends = [
      friend("u-zofia", "Zofia"),
      friend("u-adam", "Adam"),
      friend("u-ola", "Ola"),
      friend("u-ewa", "Ewa"),
    ];
    harness.directory.people = [{ id: "u-ola" }, { id: "u-adam" }] as typeof harness.directory.people;
    harness.ports.admin = fakeAdminPort({ listInvites: vi.fn(async () => [INVITE]) });

    openInvite();

    await screen.findByText(INVITE.url);
    const rows = [...document.querySelectorAll(".dlg-row")];
    expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual([
      "Ewa",
      "Zofia",
      "Adam",
      "Ola",
    ]);
    expect(within(rows[2] as HTMLElement).getByText(t("invite.alreadyMember"))).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText(t("presence.online"))).toBeVisible();
  });

  it("sends the current link to the person chosen", async () => {
    const user = userEvent.setup();
    harness.friends.friends = [friend("u-ewa", "Ewa")];
    harness.ports.admin = fakeAdminPort({ listInvites: vi.fn(async () => [INVITE]) });
    openInvite();

    await user.click(await screen.findByRole("button", { name: `${t("invite.button")} Ewa` }));

    await waitFor(() =>
      expect(harness.ports.admin.sendInvite).toHaveBeenCalledExactlyOnceWith("inv-1", "u-ewa"),
    );
  });

  it("copies the link to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    harness.ports.admin = fakeAdminPort({ listInvites: vi.fn(async () => [INVITE]) });
    openInvite();

    await user.click(await screen.findByRole("button", { name: t("invite.copy") }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(INVITE.url);
  });
});
