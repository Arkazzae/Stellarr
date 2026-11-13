import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ServerCreateModal, ServerDiscoverModal } from "./ServerDirectoryModals";

describe("ServerCreateModal", () => {
  it("normalizes the form and waits for persistence before closing", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onCreate = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = vi.fn();

    render(<ServerCreateModal open onClose={onClose} onCreate={onCreate} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa serwera/ }), "  Załoga  ");
    await user.type(screen.getByRole("textbox", { name: /^Opis/ }), "  Wieczorne granie  ");
    // Visibility lives on its own pane now, so the switch has to be reached.
    await user.click(screen.getByRole("button", { name: "Widoczność" }));
    await user.click(screen.getByRole("switch", { name: "Serwer publiczny" }));
    await user.click(screen.getByRole("button", { name: "Utwórz serwer" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "Załoga",
      description: "Wieczorne granie",
      isPublic: true,
      textChannelName: "ogólny",
      voiceChannelName: "rozmowa",
      mentionsOnly: true,
      voiceJoinSound: true,
    });
    expect(screen.getByRole("button", { name: "Tworzenie serwera…" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("keeps entered data visible after a failed creation", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error("Ta nazwa jest już zajęta."));

    render(<ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />);

    const name = screen.getByRole("textbox", { name: /Nazwa serwera/ });
    await user.type(name, "Załoga");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Ta nazwa jest już zajęta.");
    expect(name).toHaveValue("Załoga");
  });

  it("creates the starter channels the setup pane names", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(<ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa serwera/ }), "Załoga");
    await user.click(screen.getByRole("button", { name: "Kanały startowe" }));

    const text = screen.getByRole("textbox", { name: /Kanał tekstowy/ });
    await user.clear(text);
    await user.type(text, "Ogłoszenia Ekipy");
    // Opting out of the voice channel hides its name field entirely.
    await user.click(screen.getByRole("switch", { name: "Utwórz kanał głosowy" }));
    expect(screen.queryByRole("textbox", { name: /^Nazwa$/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Utwórz serwer" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        textChannelName: "ogłoszenia-ekipy",
        voiceChannelName: "",
      }),
    );
  });

  it("refuses two starter channels with the same name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(<ServerCreateModal open onClose={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole("textbox", { name: /Nazwa serwera/ }), "Załoga");
    await user.click(screen.getByRole("button", { name: "Kanały startowe" }));

    const text = screen.getByRole("textbox", { name: /Kanał tekstowy/ });
    await user.clear(text);
    await user.type(text, "rozmowa");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kanał tekstowy i głosowy nie mogą mieć tej samej nazwy.",
    );
    expect(screen.getByRole("button", { name: "Utwórz serwer" })).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("ServerDiscoverModal", () => {
  it("filters public servers and joins the selected one", async () => {
    const user = userEvent.setup();
    const onJoinServer = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ServerDiscoverModal
        open
        onClose={onClose}
        loadServers={vi.fn().mockResolvedValue([
          { id: "server-a", name: "Alpha", description: "Rozmowy" },
          { id: "server-b", name: "Beta", description: "Wieczorne granie" },
        ])}
        onJoinServer={onJoinServer}
        onJoinInvite={vi.fn()}
      />,
    );

    await screen.findByText("Alpha");
    await user.type(screen.getByRole("searchbox", { name: "Szukaj serwera" }), "beta");

    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dołącz" }));

    expect(onJoinServer).toHaveBeenCalledWith("server-b");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("passes a trimmed invite and closes only after joining", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onJoinInvite = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const onClose = vi.fn();

    render(
      <ServerDiscoverModal
        open
        onClose={onClose}
        loadServers={vi.fn().mockResolvedValue([])}
        onJoinServer={vi.fn()}
        onJoinInvite={onJoinInvite}
      />,
    );

    await screen.findByText(/Gdy ktoś udostępni serwer publicznie/);
    // The invite field and the public directory share one short card now.
    await user.type(
      screen.getByRole("textbox", { name: /Kod lub link zaproszenia/ }),
      "  https://stellarr.example/invite/abc123  ",
    );
    await user.click(screen.getByRole("button", { name: "Dołącz z zaproszenia" }));

    expect(onJoinInvite).toHaveBeenCalledWith("https://stellarr.example/invite/abc123");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Dołączanie…" })).toBeDisabled();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("offers a retry when loading public servers fails", async () => {
    const user = userEvent.setup();
    const loadServers = vi
      .fn()
      .mockRejectedValueOnce(new Error("Nie udało się pobrać listy."))
      .mockResolvedValueOnce([{ id: "server-a", name: "Alpha" }]);

    render(
      <ServerDiscoverModal
        open
        onClose={vi.fn()}
        loadServers={loadServers}
        onJoinServer={vi.fn()}
        onJoinInvite={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się pobrać listy.");
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(loadServers).toHaveBeenCalledTimes(2);
  });
});
