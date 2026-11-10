import { render, screen, within } from "@testing-library/react";
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
    roles: [],
    permissionsSupported: true,
    permissionOverrides: [],
    notificationMuted: false,
    notificationSupported: true,
    onNotificationMutedChange: vi.fn(),
    onSave: vi.fn(() => Promise.resolve()),
    onSavePermissionOverride: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    onOpenRoles: vi.fn(),
    ...overrides,
  };
}

type User = ReturnType<typeof userEvent.setup>;

const goTo = (user: User, pane: string) =>
  user.click(
    within(screen.getByRole("navigation", { name: "Sekcje ustawień kanału" })).getByRole(
      "button",
      { name: pane },
    ),
  );

// The nav item and the pane's own button share the name, so look inside the pane.
const inDeletePane = () => within(screen.getByRole("region", { name: "Usuń kanał" }));

describe("ChannelSettings editing", () => {
  it("saves the topic and slow mode of a text channel", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelSettings {...p} />);

    const topic = screen.getByRole("textbox", { name: /Temat/ });
    await user.clear(topic);
    await user.type(topic, "Nowy temat");
    await user.selectOptions(screen.getByRole("combobox", { name: /Tryb powolny/ }), "30");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Ukryj po nieaktywności/ }),
      "24",
    );
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    expect(p.onSave).toHaveBeenCalledWith({
      name: "ogolny",
      topic: "Nowy temat",
      slowModeSeconds: 30,
      hideAfterInactivityHours: 24,
    });
  });

  it("offers neither topic nor slow mode on a voice channel", () => {
    render(<ChannelSettings {...props({ channel: voiceChannel })} />);

    expect(screen.queryByRole("textbox", { name: /Temat/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Tryb powolny/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toHaveValue("Salon");
  });

  it("shows the failure and lets the member try saving again", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<ChannelSettings {...props({ onSave })} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "2");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać zmian kanału.",
    );
    const retry = screen.getByRole("button", { name: "Zapisz zmiany" });
    expect(retry).toBeEnabled();

    await user.click(retry);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the form read-only and says why when the channel is not wired", async () => {
    const user = userEvent.setup();
    render(<ChannelSettings {...props({ supported: false })} />);

    expect(screen.getByText(/nie są jeszcze podpięte do backendu/i)).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();

    await goTo(user, "Powiadomienia");
    expect(screen.queryByText(/nie są jeszcze podpięte do backendu/i)).toBeNull();
  });

  it("starts from the next channel instead of the one it was showing", async () => {
    const user = userEvent.setup();
    const rendered = render(<ChannelSettings {...props()} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "-draft");
    await goTo(user, "Uprawnienia");

    rendered.rerender(<ChannelSettings {...props({ channel: voiceChannel })} />);

    expect(screen.getByRole("dialog", { name: "Ustawienia kanału: Salon" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toHaveValue("Salon");
    expect(screen.getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();
  });
});

describe("ChannelSettings pane that is not available", () => {
  const navItem = (name: string) =>
    within(screen.getByRole("navigation", { name: "Sekcje ustawień kanału" })).getByRole(
      "button",
      { name },
    );

  it("stays on the fallback pane when management is granted while open", () => {
    const rendered = render(
      <ChannelSettings {...props({ channel: null, canManageChannel: false })} />,
    );
    expect(navItem("Powiadomienia")).toHaveAttribute("aria-current", "page");

    rendered.rerender(<ChannelSettings {...props({ channel: null, canManageChannel: true })} />);

    expect(navItem("Powiadomienia")).toHaveAttribute("aria-current", "page");
    expect(navItem("Ogólne")).not.toHaveAttribute("aria-current");
  });
});

describe("ChannelSettings for members who cannot manage the channel", () => {
  it("still shows a voice channel's voice and access panes", () => {
    render(
      <ChannelSettings {...props({ channel: voiceChannel, canManageChannel: false })} />,
    );

    expect(screen.getByRole("button", { name: "Głos i wideo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uprawnienia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Powiadomienia" })).toBeNull();
  });

  it("disables the mute switch when notifications are not wired", () => {
    render(
      <ChannelSettings
        {...props({
          canManageChannel: false,
          notificationSupported: false,
          notificationMuted: true,
        })}
      />,
    );

    const mute = screen.getByRole("button", { name: "Wycisz powiadomienia kanału" });
    expect(mute).toBeDisabled();
    expect(mute).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/nie są jeszcze podpięte do backendu/i)).toBeVisible();
  });
});

describe("ChannelSettings deletion", () => {
  it("asks for confirmation naming the channel before deleting", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelSettings {...p} />);

    await goTo(user, "Usuń kanał");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));
    expect(p.onDelete).not.toHaveBeenCalled();

    await user.click(inDeletePane().getByRole("button", { name: "Usuń #ogolny" }));
    expect(p.onDelete).toHaveBeenCalledOnce();
  });

  it("names a voice channel without a hash", async () => {
    const user = userEvent.setup();
    render(<ChannelSettings {...props({ channel: voiceChannel })} />);

    await goTo(user, "Usuń kanał");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));

    expect(inDeletePane().getByRole("button", { name: "Usuń Salon" })).toBeVisible();
  });

  it("backs out of a confirmation without deleting", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelSettings {...p} />);

    await goTo(user, "Usuń kanał");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));
    await user.click(inDeletePane().getByRole("button", { name: "Anuluj" }));

    expect(inDeletePane().getByRole("button", { name: "Usuń kanał" })).toBeVisible();
    expect(p.onDelete).not.toHaveBeenCalled();
  });

  it("reports a failed delete and keeps the confirmation open", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("forbidden"));
    render(<ChannelSettings {...props({ onDelete })} />);

    await goTo(user, "Usuń kanał");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));
    await user.click(inDeletePane().getByRole("button", { name: "Usuń #ogolny" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć kanału.");
    expect(inDeletePane().getByRole("button", { name: "Usuń #ogolny" })).toBeVisible();
  });
});
