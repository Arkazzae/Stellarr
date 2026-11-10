import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Server } from "@/ports";

import { ServerDiscoverModal } from "./ServerDiscoverModal";

const SERVERS: Server[] = [
  { id: "server-a", name: "Alpha", description: "Rozmowy" },
  { id: "server-b", name: "Beta" },
];

function Dialog({
  open = true,
  loadServers = vi.fn().mockResolvedValue(SERVERS),
  onClose = vi.fn(),
  onJoinServer = vi.fn().mockResolvedValue(undefined),
  onJoinInvite = vi.fn().mockResolvedValue(undefined),
}: Partial<React.ComponentProps<typeof ServerDiscoverModal>>) {
  return (
    <ServerDiscoverModal
      open={open}
      onClose={onClose}
      loadServers={loadServers}
      onJoinServer={onJoinServer}
      onJoinInvite={onJoinInvite}
    />
  );
}

describe("ServerDiscoverModal", () => {
  it("keeps the dialog open and says why when joining fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onJoinServer = vi.fn().mockRejectedValue(new Error("Serwer jest pełny."));

    render(<Dialog onClose={onClose} onJoinServer={onJoinServer} />);

    await screen.findByText("Alpha");
    await user.click(screen.getAllByRole("button", { name: "Dołącz" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Serwer jest pełny.");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Dołącz" })[0]).toBeEnabled();
  });

  it("words a failed join itself when the rejection carries no message", async () => {
    const user = userEvent.setup();
    const onJoinInvite = vi.fn().mockRejectedValue("refused");

    render(<Dialog onJoinInvite={onJoinInvite} />);

    await screen.findByText("Alpha");
    await user.type(screen.getByRole("textbox", { name: /Kod lub link zaproszenia/ }), "abc");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się dołączyć do serwera. Spróbuj ponownie.",
    );
    expect(onJoinInvite).toHaveBeenCalledWith("abc");
  });

  it("stays open while a join is in flight", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onJoinServer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();

    render(<Dialog onClose={onClose} onJoinServer={onJoinServer} />);

    await screen.findByText("Alpha");
    await user.click(screen.getAllByRole("button", { name: "Dołącz" })[0]!);
    await user.keyboard("{Escape}");

    for (const button of screen.getAllByRole("button", { name: "Zamknij" })) {
      expect(button).toBeDisabled();
    }
    expect(onClose).not.toHaveBeenCalled();
    // Only the clicked row announces the join; the other row is merely locked.
    expect(screen.getAllByRole("button", { name: "Dołącz" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Dołącz" })[0]).toBeDisabled();

    finish();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("describes a server without a description and tells an empty search apart from an empty list", async () => {
    const user = userEvent.setup();

    render(<Dialog />);

    expect(await screen.findByText("Bez opisu")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Szukaj serwera" }), "zzz");
    expect(screen.getByText("Żaden serwer nie pasuje")).toBeInTheDocument();
  });

  it("falls back to its own wording when loading fails without a message", async () => {
    render(<Dialog loadServers={vi.fn().mockRejectedValue("offline")} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wczytać publicznych serwerów. Spróbuj ponownie.",
    );
  });

  it("forgets the search and loads the list again each time it opens", async () => {
    const user = userEvent.setup();
    const loadServers = vi.fn().mockResolvedValue(SERVERS);
    const { rerender } = render(<Dialog loadServers={loadServers} />);

    await screen.findByText("Alpha");
    await user.type(screen.getByRole("searchbox", { name: "Szukaj serwera" }), "beta");

    rerender(<Dialog open={false} loadServers={loadServers} />);
    rerender(<Dialog loadServers={loadServers} />);

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Szukaj serwera" })).toHaveValue("");
    expect(loadServers).toHaveBeenCalledTimes(2);
  });
});
