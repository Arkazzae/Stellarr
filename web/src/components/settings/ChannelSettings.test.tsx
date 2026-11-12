import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChannelSettings,
  type ChannelSettingsProps,
  type ChannelSettingsVM,
} from "./ChannelSettings";

const textChannel: ChannelSettingsVM = {
  id: "general",
  kind: "text",
  name: "ogolny",
  topic: "Rozmowy zespolu",
  slowModeSeconds: 0,
  hideAfterInactivityHours: 0,
  audioProfile: "balanced",
  userLimit: 0,
};

const voiceChannel: ChannelSettingsVM = {
  ...textChannel,
  id: "lounge",
  kind: "voice",
  name: "Salon",
};

function props(overrides: Partial<ChannelSettingsProps> = {}): ChannelSettingsProps {
  return {
    open: true,
    onClose: vi.fn(),
    channel: textChannel,
    supported: true,
    canManageChannel: true,
    roles: [{
      id: "admin",
      name: "Administrator",
      color: "#a78bfa",
      permissions: [],
      memberCount: 1,
      isSystem: false,
      isOwner: false,
    }],
    permissionsSupported: true,
    permissionOverrides: [],
    notificationMuted: false,
    onNotificationMutedChange: vi.fn(),
    onSave: vi.fn(),
    onSavePermissionOverride: vi.fn(),
    onDelete: vi.fn(),
    onOpenRoles: vi.fn(),
    ...overrides,
  };
}

describe("ChannelSettings", () => {
  it("can mount closed without a channel for a regular member", () => {
    const closed = props({
      open: false,
      channel: null,
      supported: false,
      canManageChannel: false,
      permissionsSupported: false,
    });
    const rendered = render(<ChannelSettings {...closed} />);

    rendered.rerender(
      <ChannelSettings
        {...closed}
        open
        channel={textChannel}
      />,
    );

    expect(screen.getByRole("heading", { name: "Powiadomienia" })).toBeVisible();
  });

  it("uses the shared settings shell with icon-led channel navigation", async () => {
    const user = userEvent.setup();
    const p = props();
    const { container } = render(<ChannelSettings {...p} />);

    expect(
      screen.getByRole("dialog", { name: "Ustawienia kanału: #ogolny" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".sv.ch-settings")).toBeInTheDocument();

    for (const name of ["Ogólne", "Powiadomienia", "Uprawnienia", "Usuń kanał"]) {
      expect(screen.getByRole("button", { name }).querySelector("svg")).not.toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Głos i wideo" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Uprawnienia" }));
    expect(screen.getByRole("region", { name: "Uprawnienia kanału" })).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Otwórz role serwera" }));
    expect(p.onOpenRoles).toHaveBeenCalledOnce();
  });

  it("changes this user's text-channel notification mute immediately", async () => {
    const user = userEvent.setup();
    const onNotificationMutedChange = vi.fn();
    render(
      <ChannelSettings
        {...props({ onNotificationMutedChange })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Powiadomienia" }));
    const mute = screen.getByRole("button", {
      name: "Wycisz powiadomienia kanału",
    });
    expect(mute).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Zapisz zmiany" })).toBeNull();

    await user.click(mute);
    expect(onNotificationMutedChange).toHaveBeenCalledWith(true);
  });

  it("opens a regular member on the editable notification pane", () => {
    render(
      <ChannelSettings
        {...props({
          supported: false,
          canManageChannel: false,
          permissionsSupported: false,
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Powiadomienia" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Wycisz powiadomienia kanału" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Ogólne" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Uprawnienia" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usuń kanał" })).toBeNull();
    expect(screen.queryByText(/Nie masz uprawnienia/)).toBeNull();
  });

  it("adds a dedicated voice and video pane for voice channels", async () => {
    const user = userEvent.setup();
    render(<ChannelSettings {...props({ channel: voiceChannel })} />);

    const voiceTab = screen.getByRole("button", { name: "Głos i wideo" });
    expect(voiceTab.querySelector("svg")).not.toBeNull();
    await user.click(voiceTab);

    expect(screen.getByRole("combobox", { name: /Limit osób/ })).toBeVisible();
  });

  it("saves a voice-channel patch from the fixed action bar", async () => {
    const user = userEvent.setup();
    const p = props({ channel: voiceChannel });
    render(<ChannelSettings {...p} />);

    await user.click(screen.getByRole("button", { name: "Głos i wideo" }));
    const limit = screen.getByRole("combobox", { name: /Limit osób/ });
    await user.selectOptions(limit, "10");

    const save = screen.getByRole("button", { name: "Zapisz zmiany" });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(p.onSave).toHaveBeenCalledWith({
      name: "Salon",
      hideAfterInactivityHours: 0,
      userLimit: 10,
    });
  });

  it("saves a trimmed text-channel patch from the fixed action bar", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelSettings {...p} />);

    const save = screen.getByRole("button", { name: "Zapisz zmiany" });
    expect(save).toBeDisabled();

    const name = screen.getByRole("textbox", { name: /Nazwa/ });
    await user.clear(name);
    await user.type(name, "  aktualnosci  ");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(p.onSave).toHaveBeenCalledWith({
      name: "aktualnosci",
      topic: "Rozmowy zespolu",
      slowModeSeconds: 0,
      hideAfterInactivityHours: 0,
    });
  });
});
