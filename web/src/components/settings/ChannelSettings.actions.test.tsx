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

const inDeletePane = () => within(screen.getByRole("region", { name: "Strefa zagrożenia" }));

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

  it("keeps the form read-only and says why without permission to manage channels", async () => {
    const user = userEvent.setup();
    render(<ChannelSettings {...props({ supported: false })} />);

    expect(screen.getByText(/Nie masz uprawnienia do zarządzania kanałami/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toBeDisabled();
    // Nothing can be changed, so nothing is ever offered for saving.
    expect(screen.queryByRole("button", { name: "Zapisz zmiany" })).toBeNull();

    await goTo(user, "Powiadomienia");
    expect(screen.queryByText(/Nie masz uprawnienia/)).toBeNull();
  });

  it("starts from the next channel instead of the one it was showing", async () => {
    const user = userEvent.setup();
    const rendered = render(<ChannelSettings {...props()} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "-draft");

    rendered.rerender(<ChannelSettings {...props({ channel: voiceChannel })} />);

    expect(screen.getByRole("dialog", { name: "Ustawienia kanału: Salon" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toHaveValue("Salon");
    expect(screen.queryByRole("button", { name: "Zapisz zmiany" })).toBeNull();
  });

  it("holds the overview while it has unsaved changes, until they are reset", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ChannelSettings {...props({ onClose })} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa/ }), "-draft");
    await goTo(user, "Uprawnienia");
    await user.click(screen.getByRole("button", { name: "Zamknij ustawienia kanału" }));

    // Neither the pane change nor the cross threw the draft away.
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toHaveValue("ogolny-draft");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Zmiany" })).toHaveTextContent(
      "Najpierw zapisz albo przywróć",
    );

    await user.click(screen.getByRole("button", { name: "Przywróć" }));
    expect(screen.getByRole("textbox", { name: /Nazwa/ })).toHaveValue("ogolny");
    expect(screen.queryByRole("region", { name: "Zmiany" })).toBeNull();

    await goTo(user, "Uprawnienia");
    expect(screen.queryByRole("textbox", { name: /Nazwa/ })).toBeNull();
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
    expect(navItem("Przegląd")).not.toHaveAttribute("aria-current");
  });
});

describe("ChannelSettings for members who cannot manage the channel", () => {
  it("still shows a voice channel's overview and access panes", () => {
    render(
      <ChannelSettings {...props({ channel: voiceChannel, canManageChannel: false })} />,
    );

    expect(screen.getByRole("button", { name: "Przegląd" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uprawnienia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Powiadomienia" })).toBeNull();
  });
});

describe("ChannelSettings deletion", () => {
  it("asks for confirmation naming the channel before deleting", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelSettings {...p} />);

    await goTo(user, "Strefa zagrożenia");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));
    expect(p.onDelete).not.toHaveBeenCalled();

    await user.click(inDeletePane().getByRole("button", { name: "Usuń #ogolny" }));
    expect(p.onDelete).toHaveBeenCalledOnce();
  });

  it("names a voice channel without a hash", async () => {
    const user = userEvent.setup();
    render(<ChannelSettings {...props({ channel: voiceChannel })} />);

    await goTo(user, "Strefa zagrożenia");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));

    expect(inDeletePane().getByRole("button", { name: "Usuń Salon" })).toBeVisible();
  });

  it("backs out of a confirmation without deleting", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelSettings {...p} />);

    await goTo(user, "Strefa zagrożenia");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));
    await user.click(inDeletePane().getByRole("button", { name: "Anuluj" }));

    expect(inDeletePane().getByRole("button", { name: "Usuń kanał" })).toBeVisible();
    expect(p.onDelete).not.toHaveBeenCalled();
  });

  it("reports a failed delete and keeps the confirmation open", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("forbidden"));
    render(<ChannelSettings {...props({ onDelete })} />);

    await goTo(user, "Strefa zagrożenia");
    await user.click(inDeletePane().getByRole("button", { name: "Usuń kanał" }));
    await user.click(inDeletePane().getByRole("button", { name: "Usuń #ogolny" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się usunąć kanału.");
    expect(inDeletePane().getByRole("button", { name: "Usuń #ogolny" })).toBeVisible();
  });
});
