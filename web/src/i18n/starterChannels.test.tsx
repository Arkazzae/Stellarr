import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCreateModal } from "@/components/settings/ServerCreateModal";
import { LanguageProvider } from "@/state/LanguageProvider";
import { useLanguage } from "@/state/hooks";

beforeEach(() => {
  localStorage.clear();
});

const openStarterChannels = (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(screen.getByRole("button", { name: label }));

describe("the create-server dialog's starter channel names", () => {
  it("are offered in English to someone using the English interface", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LanguageProvider initialLocale="en">
        <ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />
      </LanguageProvider>,
    );

    await user.type(screen.getByRole("textbox", { name: /Server name/ }), "Crew");
    await openStarterChannels(user, "Starter channels");

    expect(screen.getByRole("textbox", { name: /Text channel/ })).toHaveValue("general");
    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("voice");

    await user.click(screen.getByRole("button", { name: "Create a server" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ textChannelName: "general", voiceChannelName: "voice" }),
    );
  });

  it("keep what the person typed instead of the suggestion", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <LanguageProvider initialLocale="en">
        <ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />
      </LanguageProvider>,
    );

    await user.type(screen.getByRole("textbox", { name: /Server name/ }), "Crew");
    await openStarterChannels(user, "Starter channels");
    const text = screen.getByRole("textbox", { name: /Text channel/ });
    await user.clear(text);
    await user.type(text, "Lobby Chat");
    await user.click(screen.getByRole("button", { name: "Create a server" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ textChannelName: "lobby-chat", voiceChannelName: "voice" }),
    );
  });

  it("follow the language chosen while the dialog was closed", async () => {
    const user = userEvent.setup();

    function Harness() {
      const { update } = useLanguage();
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => update({ locale: "en" })}>english</button>
          <button onClick={() => setOpen((current) => !current)}>toggle</button>
          <ServerCreateModal open={open} onClose={vi.fn()} onCreate={vi.fn()} />
        </>
      );
    }

    render(
      <LanguageProvider initialLocale="pl">
        <Harness />
      </LanguageProvider>,
    );
    await openStarterChannels(user, "Kanały startowe");
    expect(screen.getByRole("textbox", { name: /Kanał tekstowy/ })).toHaveValue("ogólny");

    await user.click(screen.getByRole("button", { name: "toggle" }));
    await user.click(screen.getByRole("button", { name: "english" }));
    await user.click(screen.getByRole("button", { name: "toggle" }));
    await openStarterChannels(user, "Starter channels");

    expect(screen.getByRole("textbox", { name: /Text channel/ })).toHaveValue("general");
    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("voice");
  });
});
