import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { fakeAdminPort } from "@/test/adminPort";
import { TEXT_CHANNEL, VOICE_CHANNEL, harness, resetHarness } from "@/test/modalsHarness";

import { ModalsContainer } from "./ModalsContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translateMessage("pl", key, values);

const nameField = () => screen.getByRole("textbox", { name: new RegExp(`^${t("channel.name")}`) });

function openChannelSettings(channelId: string) {
  harness.ui.modal = "channel";
  harness.ui.channelSettingsId = channelId;
  render(<ModalsContainer />);
}

beforeEach(resetHarness);

describe("ModalsContainer: channel settings", () => {
  it("saves a text channel with the fields a text channel has", async () => {
    const user = userEvent.setup();
    openChannelSettings(TEXT_CHANNEL.id);

    await user.clear(nameField());
    await user.type(nameField(), "lobby");
    await user.click(screen.getByRole("button", { name: t("channel.settingsSave") }));

    expect(harness.ports.admin.updateChannel).toHaveBeenCalledExactlyOnceWith(TEXT_CHANNEL.id, {
      name: "lobby",
      topic: "Everything and nothing.",
      slowModeSeconds: 0,
      hideAfterInactivityHours: 0,
    });
  });

  it("saves a voice channel with its person limit and no topic", async () => {
    const user = userEvent.setup();
    openChannelSettings(VOICE_CHANNEL.id);

    await user.type(nameField(), "!");
    await user.click(screen.getByRole("button", { name: t("channel.settingsSave") }));

    expect(harness.ports.admin.updateChannel).toHaveBeenCalledExactlyOnceWith(VOICE_CHANNEL.id, {
      name: "Salon!",
      userLimit: 0,
      hideAfterInactivityHours: 0,
    });
  });

  it("reads the roles when it opens, for the permissions pane", async () => {
    harness.ports.admin = fakeAdminPort();

    openChannelSettings(TEXT_CHANNEL.id);

    await waitFor(() => expect(harness.ports.admin.listRoles).toHaveBeenCalledOnce());
    expect(harness.ports.admin.listPermissionOverrides).toHaveBeenCalledExactlyOnceWith(
      "channel",
      TEXT_CHANNEL.id,
    );
  });

  it("deletes the channel after a confirmation and closes the dialog", async () => {
    const user = userEvent.setup();
    openChannelSettings(TEXT_CHANNEL.id);

    await user.click(screen.getByRole("button", { name: t("server.danger") }));
    const pane = screen.getByRole("region", { name: t("server.danger") });
    await user.click(within(pane).getByRole("button", { name: t("channel.delete") }));
    await user.click(
      within(pane).getByRole("button", { name: t("settings.deleteNamedServer", { name: "#general" }) }),
    );

    await waitFor(() => expect(harness.ui.closeModal).toHaveBeenCalledOnce());
    expect(harness.ports.admin.deleteChannel).toHaveBeenCalledExactlyOnceWith(TEXT_CHANNEL.id);
  });

  it("stays open and says so when the channel cannot be deleted", async () => {
    const user = userEvent.setup();
    harness.ports.admin = fakeAdminPort({
      deleteChannel: vi.fn(async () => {
        throw new ApiError("server", "boom", 500);
      }),
    });
    openChannelSettings(TEXT_CHANNEL.id);

    await user.click(screen.getByRole("button", { name: t("server.danger") }));
    const pane = screen.getByRole("region", { name: t("server.danger") });
    await user.click(within(pane).getByRole("button", { name: t("channel.delete") }));
    await user.click(
      within(pane).getByRole("button", { name: t("settings.deleteNamedServer", { name: "#general" }) }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(t("channel.deleteFailed"));
    expect(harness.ui.closeModal).not.toHaveBeenCalled();
  });

  describe("for a member who cannot manage channels", () => {
    beforeEach(() => {
      harness.directory.canManageChannels = false;
    });

    it("offers a text channel's notifications and mutes it for this person only", async () => {
      const user = userEvent.setup();
      harness.account.preferences = {
        ...harness.account.preferences,
        mutedChannelIds: ["ch-other"],
      };
      openChannelSettings(TEXT_CHANNEL.id);

      await user.click(screen.getByRole("button", { name: t("channel.muteNotifications") }));

      expect(harness.account.setPreferences).toHaveBeenCalledExactlyOnceWith({
        mutedChannelIds: ["ch-other", TEXT_CHANNEL.id],
      });
      expect(harness.ports.admin.updateChannel).not.toHaveBeenCalled();
    });

    it("unmutes by taking only this channel out of the muted list", async () => {
      const user = userEvent.setup();
      harness.account.preferences = {
        ...harness.account.preferences,
        mutedChannelIds: ["ch-other", TEXT_CHANNEL.id],
      };
      openChannelSettings(TEXT_CHANNEL.id);

      await user.click(screen.getByRole("button", { name: t("channel.muteNotifications") }));

      expect(harness.account.setPreferences).toHaveBeenCalledExactlyOnceWith({
        mutedChannelIds: ["ch-other"],
      });
    });

    it("has nothing to show for a voice channel", () => {
      openChannelSettings(VOICE_CHANNEL.id);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("ModalsContainer: new channel", () => {
  /** Opens the dialog from the voice caption, names the channel and creates it. */
  async function createChannel(
    name: string,
    place?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
  ) {
    const user = userEvent.setup();
    harness.ui.modal = "channel-new";
    harness.ui.newChannelKind = "voice";
    render(<ModalsContainer />);
    await place?.(user);
    await user.type(nameField(), name);
    await user.click(screen.getByRole("button", { name: t("channel.create") }));
  }

  it("creates the channel of the kind whose caption was pressed and closes", async () => {
    await createChannel("Game Night");

    await waitFor(() => expect(harness.ui.closeModal).toHaveBeenCalledOnce());
    expect(harness.ports.admin.createChannel).toHaveBeenCalledExactlyOnceWith({
      name: "game-night",
      kind: "voice",
    });
  });

  it("draws the server's own rail and creates where the row was put", async () => {
    await createChannel("Game Night", async (user) => {
      const slice = screen.getByRole("group", { name: t("channel.placement") });
      expect(within(slice).getByText(harness.directory.server.name)).toBeVisible();
      expect(within(slice).getByText(TEXT_CHANNEL.name)).toBeVisible();
      await user.click(
        screen.getByRole("button", {
          name: t("channel.moveTo", { group: t("shell.textChannels") }),
        }),
      );
    });

    await waitFor(() => expect(harness.ui.closeModal).toHaveBeenCalledOnce());
    expect(harness.ports.admin.createChannel).toHaveBeenCalledExactlyOnceWith({
      name: "game-night",
      kind: "text",
    });
  });

  it("says when the name is already taken", async () => {
    harness.ports.admin = fakeAdminPort({
      createChannel: vi.fn(async () => {
        throw new ApiError("invalid", "duplicate", 409);
      }),
    });

    await createChannel("general");

    expect(await screen.findByText(t("channel.createDuplicate"))).toBeVisible();
    expect(harness.ui.closeModal).not.toHaveBeenCalled();
  });

  it("words any other API failure by its kind", async () => {
    harness.ports.admin = fakeAdminPort({
      createChannel: vi.fn(async () => {
        throw new ApiError("forbidden", "no", 403);
      }),
    });

    await createChannel("secret");

    expect(await screen.findByText(t("session.forbidden"))).toBeVisible();
  });

  it("falls back to its own sentence for a failure that is not an API error", async () => {
    harness.ports.admin = fakeAdminPort({
      createChannel: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });

    await createChannel("secret");

    expect(await screen.findByText(t("channel.createFailed"))).toBeVisible();
  });
});
