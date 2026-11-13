import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cockpitApi, type CockpitServer } from "@/lib/api";
import { ServersPage } from "@/pages/servers-page";
import { choose } from "@/test/dropdown";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: {
      ...original.cockpitApi,
      servers: vi.fn(),
      serverMembers: vi.fn(),
      transferServer: vi.fn(),
      deleteServer: vi.fn(),
    },
  };
});

const serversMock = vi.mocked(cockpitApi.servers);
const membersMock = vi.mocked(cockpitApi.serverMembers);
const transferMock = vi.mocked(cockpitApi.transferServer);
const deleteMock = vi.mocked(cockpitApi.deleteServer);

const instance: CockpitServer = {
  id: "s-instance",
  name: "Domek",
  description: "Tu mieszkamy",
  isPublic: false,
  createdAt: "2026-01-01T10:00:00Z",
  isInstance: true,
  owner: { id: "u-ola", username: "ola", displayName: "Ola Owner" },
  memberCount: 12,
  channelCount: 5,
};

const corner: CockpitServer = {
  id: "s-corner",
  name: "Kącik Jo",
  description: "",
  isPublic: true,
  createdAt: "2026-02-01T10:00:00Z",
  isInstance: false,
  owner: { id: "u-jo", username: "jo", displayName: "Jo" },
  memberCount: 2,
  channelCount: 2,
};

const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

beforeEach(() => {
  vi.clearAllMocks();
  serversMock.mockResolvedValue([instance, corner]);
  membersMock.mockResolvedValue([
    { id: "u-jo", username: "jo", displayName: "Jo", isOwner: true },
    { id: "u-ada", username: "ada", displayName: "Ada", isOwner: false },
  ]);
  transferMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
});

describe("ServersPage", () => {
  it("lists every server with its owner, counts and visibility", async () => {
    render(<ServersPage />);

    const instanceRow = await screen.findByRole("row", { name: /Domek/ });
    expect(within(instanceRow).getByText("Serwer instancji")).toBeTruthy();
    expect(within(instanceRow).getByText("@ola")).toBeTruthy();
    expect(within(instanceRow).getByText("12")).toBeTruthy();
    expect(within(instanceRow).getByText("Prywatny")).toBeTruthy();
    expect(within(row("Kącik Jo")).getByText("Publiczny")).toBeTruthy();
  });

  it("offers no actions for the instance server", async () => {
    render(<ServersPage />);
    await screen.findByRole("row", { name: /Domek/ });

    expect(screen.queryByRole("button", { name: "Akcje dla serwera Domek" })).toBeNull();
    expect(screen.getByRole("button", { name: "Akcje dla serwera Kącik Jo" })).toBeTruthy();
  });

  it("hands a server to a member other than its owner", async () => {
    const user = userEvent.setup();
    render(<ServersPage />);
    await user.click(await screen.findByRole("button", { name: "Akcje dla serwera Kącik Jo" }));
    await user.click(await screen.findByRole("menuitem", { name: "Przekaż własność…" }));

    const sheet = await screen.findByRole("dialog");
    const field = await within(sheet).findByRole("combobox", { name: "Nowy właściciel" });
    await user.click(field);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Ada (@ada)"]);
    await user.click(options[0]!);
    await user.click(within(sheet).getByRole("button", { name: "Przekaż własność" }));

    expect(membersMock).toHaveBeenCalledWith("s-corner", expect.any(AbortSignal));
    expect(transferMock).toHaveBeenCalledWith("s-corner", "u-ada");
    expect(await screen.findByText("Serwer Kącik Jo należy teraz do Ada.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(serversMock).toHaveBeenCalledTimes(2);
  });

  it("hands the server to the member picked from the list", async () => {
    membersMock.mockResolvedValue([
      { id: "u-jo", username: "jo", displayName: "Jo", isOwner: true },
      { id: "u-ada", username: "ada", displayName: "Ada", isOwner: false },
      { id: "u-bob", username: "bob", displayName: "Bob", isOwner: false },
    ]);
    const user = userEvent.setup();
    render(<ServersPage />);
    await user.click(await screen.findByRole("button", { name: "Akcje dla serwera Kącik Jo" }));
    await user.click(await screen.findByRole("menuitem", { name: "Przekaż własność…" }));
    const sheet = await screen.findByRole("dialog");

    await choose(user, await within(sheet).findByRole("combobox", { name: "Nowy właściciel" }), "Bob (@bob)");
    await user.click(within(sheet).getByRole("button", { name: "Przekaż własność" }));

    expect(transferMock).toHaveBeenCalledWith("s-corner", "u-bob");
  });

  it("deletes a server only once its name is typed", async () => {
    const user = userEvent.setup();
    render(<ServersPage />);
    await user.click(await screen.findByRole("button", { name: "Akcje dla serwera Kącik Jo" }));
    await user.click(await screen.findByRole("menuitem", { name: "Usuń serwer…" }));

    const dialog = await screen.findByRole("dialog", { name: "Usunąć serwer Kącik Jo?" });
    const submit = within(dialog).getByRole("button", { name: "Usuń serwer" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Wpisz Kącik Jo, aby potwierdzić"), "Kącik");
    expect(submit.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("Wpisz Kącik Jo, aby potwierdzić"), " Jo");
    await user.click(submit);

    expect(deleteMock).toHaveBeenCalledWith("s-corner");
    expect(await screen.findByText("Usunięto serwer Kącik Jo.")).toBeTruthy();
  });

  it("shows the reason when the list cannot be read", async () => {
    serversMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(<ServersPage />);

    expect(await screen.findByText("Backend odpowiedział kodem 500.")).toBeTruthy();
  });
});
