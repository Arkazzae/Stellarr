import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateMessage, type MessageKey } from "@/i18n";
import { ApiError } from "@/lib/api/errors";
import { harness, resetHarness } from "@/test/modalsHarness";

import { ModalsContainer } from "./ModalsContainer";

vi.mock("@/state/hooks", async () => (await import("@/test/modalsHarness")).hooksModule());

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translateMessage("pl", key, values);

const PUBLIC = { id: "srv-open", name: "Open House", description: "Come in" };

beforeEach(resetHarness);
afterEach(() => vi.restoreAllMocks());

function expectServerActivated(serverId: string) {
  expect(harness.directory.selectServer).toHaveBeenCalledExactlyOnceWith(serverId);
  expect(harness.ui.openServer).toHaveBeenCalledOnce();
  expect(harness.session.reload).toHaveBeenCalledOnce();
}

describe("ModalsContainer: creating a server", () => {
  async function submit() {
    const user = userEvent.setup();
    harness.ui.modal = "server-create";
    render(<ModalsContainer />);
    await user.type(screen.getByRole("textbox", { name: new RegExp(`^${t("shell.serverName")}`) }), "Garage");
    await user.click(screen.getByRole("button", { name: t("shell.createServer") }));
  }

  it("creates the server with its starter channels and switches to it", async () => {
    harness.directory.createServer.mockResolvedValue({ id: "srv-new", name: "Garage" });

    await submit();

    await waitFor(() => expectServerActivated("srv-new"));
    expect(harness.directory.createServer).toHaveBeenCalledExactlyOnceWith({
      name: "Garage",
      description: "",
      isPublic: false,
      textChannelName: "ogólny",
      voiceChannelName: "rozmowa",
      mentionsOnly: true,
      voiceJoinSound: true,
    });
  });

  it("stays on the current server and words the failure when creation is refused", async () => {
    harness.directory.createServer.mockRejectedValue(new ApiError("rate-limited", "slow", 429));

    await submit();

    expect(await screen.findByText(t("session.rateLimited"))).toBeVisible();
    expect(harness.directory.selectServer).not.toHaveBeenCalled();
  });
});

describe("ModalsContainer: finding a server", () => {
  async function openDiscover() {
    harness.ui.modal = "server-discover";
    harness.directory.discoverServers.mockResolvedValue([PUBLIC]);
    render(<ModalsContainer />);
    await screen.findByText(PUBLIC.name);
  }

  const joinByInvite = async (text: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: t("shell.inviteCode") }), text);
    await user.click(screen.getByRole("button", { name: t("shell.joinInvite") }));
  };

  it("lists the public servers and joins the one picked", async () => {
    harness.directory.joinServer.mockResolvedValue({ id: PUBLIC.id, name: PUBLIC.name });
    await openDiscover();

    await userEvent.setup().click(screen.getByRole("button", { name: t("shell.joinServer") }));

    await waitFor(() => expectServerActivated(PUBLIC.id));
    expect(harness.directory.joinServer).toHaveBeenCalledExactlyOnceWith(PUBLIC.id);
  });

  it.each([
    ["a pasted link", "https://chat.example/invite/abc123", "abc123"],
    ["a link with a query", " https://chat.example/invite/abc123?ref=mail#top ", "abc123"],
    ["a path", "/invite/abc123/", "abc123"],
    ["a bare code", "abc123", "abc123"],
  ])("joins from %s by its code", async (_name, pasted, code) => {
    harness.directory.joinInvite.mockResolvedValue({ id: "srv-invited", name: "Invited" });
    await openDiscover();

    await joinByInvite(pasted);

    await waitFor(() => expectServerActivated("srv-invited"));
    expect(harness.directory.joinInvite).toHaveBeenCalledExactlyOnceWith(code);
  });

  it("says the invite is not valid when the server does not know it", async () => {
    harness.directory.joinInvite.mockRejectedValue(new ApiError("not-found", "no such invite", 404));
    await openDiscover();

    await joinByInvite("gone");

    expect(await screen.findByRole("alert")).toHaveTextContent(t("shell.inviteInvalidDetail"));
    expect(harness.directory.selectServer).not.toHaveBeenCalled();
  });

  it("words other join failures by their kind, or with its own sentence", async () => {
    harness.directory.joinInvite
      .mockRejectedValueOnce(new ApiError("forbidden", "banned", 403))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    await openDiscover();

    await joinByInvite("abc");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("session.forbidden"));

    await userEvent.setup().click(screen.getByRole("button", { name: t("shell.joinInvite") }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t("shell.serverJoinFailed")),
    );
  });

  it("words a failure to load the directory", async () => {
    harness.ui.modal = "server-discover";
    harness.directory.discoverServers.mockRejectedValue(new ApiError("network", "offline"));

    render(<ModalsContainer />);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("session.network"));
  });
});

describe("ModalsContainer: client download", () => {
  it("lists the clients this instance publishes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            version: "1.4.0",
            publishedAt: "2026-03-01T00:00:00.000Z",
            notes: "",
            platform: "android",
            architecture: "arm64-v8a",
            fileName: "stellarr-1.4.0.apk",
            sizeBytes: 1_048_576,
            sha256: "ab".repeat(32),
            downloadUrl: "/downloads/stellarr-1.4.0.apk",
          },
        ]),
        { status: 200 },
      ),
    );
    harness.ui.modal = "client";

    render(<ModalsContainer />);

    expect(await screen.findByText("Android")).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledWith("/api/client/releases", expect.anything());
  });
});
