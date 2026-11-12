import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminMember, Invite, Role } from "@/ports";

import { ChannelsPane, type ChannelsPaneProps } from "./ChannelsPane";
import { DangerPane } from "./DangerPane";
import { InvitesPane } from "./InvitesPane";
import { MembersPane } from "./MembersPane";
import { RolesPane } from "./RolesPane";

function role(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-crew",
    name: "Ekipa",
    color: "#8b7cf6",
    permissions: ["manageChannels"],
    memberCount: 2,
    isSystem: false,
    isOwner: false,
    ...overrides,
  };
}

const OWNER = role({
  id: "role-owner",
  name: "Właściciel",
  permissions: [],
  memberCount: 1,
  isSystem: true,
  isOwner: true,
});

describe("ChannelsPane sections", () => {
  function props(overrides: Partial<ChannelsPaneProps> = {}): ChannelsPaneProps {
    return {
      supported: true,
      channels: [
        { id: "c1", name: "ogólny", kind: "text", sectionId: "s1" },
        { id: "c2", name: "salon", kind: "voice", sectionId: "s1" },
        { id: "c3", name: "luźne", kind: "text" },
      ],
      onAdd: vi.fn(),
      onEdit: vi.fn(),
      sectionsSupported: true,
      sections: [
        { id: "s1", name: "Główne" },
        { id: "s2", name: "Dodatki" },
      ],
      onAddSection: vi.fn(),
      onEditSection: vi.fn(),
      onMoveSectionUp: vi.fn().mockResolvedValue(undefined),
      onMoveSectionDown: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("counts the channels each section holds", () => {
    render(<ChannelsPane {...props()} />);

    const sections = screen.getByRole("region", { name: "Sekcje" });
    expect(within(sections).getByText("Główne").nextElementSibling).toHaveTextContent(
      "Liczba kanałów: 2",
    );
    expect(within(sections).getByText("Dodatki").nextElementSibling).toHaveTextContent(
      "Liczba kanałów: 0",
    );
  });

  it("moves a section and stops the first and last from moving past the ends", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelsPane {...p} />);

    expect(screen.getByRole("button", { name: "Przesuń sekcję Główne w górę" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przesuń sekcję Dodatki w dół" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Przesuń sekcję Główne w dół" }));
    await user.click(screen.getByRole("button", { name: "Przesuń sekcję Dodatki w górę" }));

    expect(p.onMoveSectionDown).toHaveBeenCalledExactlyOnceWith("s1");
    expect(p.onMoveSectionUp).toHaveBeenCalledExactlyOnceWith("s2");
  });

  it("reports a failed reorder and keeps the rows usable", async () => {
    const user = userEvent.setup();
    const p = props({ onMoveSectionDown: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<ChannelsPane {...p} />);

    await user.click(screen.getByRole("button", { name: "Przesuń sekcję Główne w dół" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zapisać kolejności sekcji.");
    expect(screen.getByRole("button", { name: "Przesuń sekcję Dodatki w górę" })).toBeEnabled();
  });

  it("leaves section actions off without permission to manage channels", () => {
    render(<ChannelsPane {...props({ sectionsSupported: false })} />);

    expect(screen.getByRole("button", { name: "Dodaj sekcję" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edytuj sekcję Główne" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Przesuń sekcję Dodatki w górę" })).toBeDisabled();
  });

  it("opens the editors for a section and a channel", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<ChannelsPane {...p} />);

    await user.click(screen.getByRole("button", { name: "Dodaj sekcję" }));
    await user.click(screen.getByRole("button", { name: "Edytuj sekcję Dodatki" }));

    expect(p.onAddSection).toHaveBeenCalledOnce();
    expect(p.onEditSection).toHaveBeenCalledWith("s2");
  });
});

describe("RolesPane editor", () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("button", { name: `Uprawnienia roli ${name}` }));
    return screen.getByRole("region", { name: `Uprawnienia: ${name}` });
  }

  it("saves the edited name, colour and permissions", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <RolesPane supported roles={[role()]} onCreate={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />,
    );
    const editor = await openEditor(user, "Ekipa");

    const name = within(editor).getByRole("textbox", { name: "Nazwa" });
    const color = within(editor).getByRole("textbox", { name: "Kolor" });
    await user.clear(name);
    await user.type(name, "Moderacja");
    await user.clear(color);
    await user.type(color, "#ff0000");
    await user.click(within(editor).getByRole("checkbox", { name: "Zarządzanie kanałami" }));
    await user.click(within(editor).getByRole("checkbox", { name: "Zarządzanie banami" }));
    await user.click(within(editor).getByRole("button", { name: "Zapisz" }));

    expect(onUpdate).toHaveBeenCalledWith("role-crew", {
      name: "Moderacja",
      color: "#ff0000",
      permissions: ["manageBans"],
    });
  });

  it("cannot save a role without a name", async () => {
    const user = userEvent.setup();
    render(
      <RolesPane supported roles={[role()]} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />,
    );
    const editor = await openEditor(user, "Ekipa");

    await user.clear(within(editor).getByRole("textbox", { name: "Nazwa" }));

    expect(within(editor).getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("closes the editor once the role is deleted", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <RolesPane supported roles={[role()]} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={onDelete} />,
    );
    const editor = await openEditor(user, "Ekipa");

    await user.click(within(editor).getByRole("button", { name: "Usuń rolę" }));

    expect(onDelete).toHaveBeenCalledWith("role-crew");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Uprawnienia: Ekipa" })).toBeNull());
  });

  it("keeps the editor open and says so when the role cannot be deleted", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("in use"));
    render(
      <RolesPane supported roles={[role()]} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={onDelete} />,
    );
    const editor = await openEditor(user, "Ekipa");

    await user.click(within(editor).getByRole("button", { name: "Usuń rolę" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zapisać zmiany roli.");
    expect(screen.getByRole("region", { name: "Uprawnienia: Ekipa" })).toBeVisible();
  });

  it("locks the owner role and protects system roles from deletion", async () => {
    const user = userEvent.setup();
    render(
      <RolesPane
        supported
        roles={[OWNER, role({ id: "role-default", name: "Wszyscy", isSystem: true })]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const ownerEditor = await openEditor(user, "Właściciel");
    for (const field of within(ownerEditor).getAllByRole("textbox")) expect(field).toBeDisabled();
    expect(within(ownerEditor).getByRole("button", { name: "Zapisz" })).toBeDisabled();

    const systemEditor = await openEditor(user, "Wszyscy");
    expect(within(systemEditor).getByRole("button", { name: "Usuń rolę" })).toBeDisabled();
    expect(within(systemEditor).getByRole("button", { name: "Zapisz" })).toBeEnabled();
  });

  it("summarises each role by its members and what it may do", () => {
    render(
      <RolesPane
        supported
        roles={[
          OWNER,
          role({ permissions: [] }),
          role({ id: "role-some", name: "Pomoc", permissions: ["manageBans", "viewAuditLog"], memberCount: 5 }),
        ]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("1 osoba · właściciel serwera")).toBeVisible();
    expect(screen.getByText("2 osoby · bez uprawnień")).toBeVisible();
    expect(screen.getByText("5 osób · 2 uprawnienia")).toBeVisible();
  });
});

describe("MembersPane roles", () => {
  const member = (id: string, name: string, roleId: string): AdminMember => ({
    user: { id, username: name.toLowerCase(), displayName: name, presence: "online" },
    roleId,
    joinedAt: new Date(2026, 0, 15, 12).toISOString(),
  });

  it("shows the owner's role as a fixed chip instead of a menu", () => {
    render(
      <MembersPane
        supported
        roles={[OWNER, role()]}
        members={[member("u-1", "Maja", OWNER.id), member("u-2", "Jan", "role-crew")]}
        onAssignRole={vi.fn()}
      />,
    );

    expect(screen.getByText("Właściciel", { selector: ".role-chip" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Rola osoby Maja" })).toBeNull();
    const menu = screen.getByRole("combobox", { name: "Rola osoby Jan" });
    expect(within(menu).queryByRole("option", { name: "Właściciel" })).toBeNull();
  });

  it("falls back to read-only chips without permission to manage members", () => {
    render(
      <MembersPane
        supported={false}
        roles={[role()]}
        members={[member("u-2", "Jan", "role-crew")]}
        onAssignRole={vi.fn()}
      />,
    );

    expect(screen.getByText(/Nie masz uprawnienia do przypisywania ról/)).toBeVisible();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Ekipa", { selector: ".role-chip" })).toBeVisible();
  });

  it("says so when assigning a role fails", async () => {
    const user = userEvent.setup();
    const other = role({ id: "role-other", name: "Goście" });
    const onAssignRole = vi.fn().mockRejectedValue(new Error("forbidden"));
    render(
      <MembersPane
        supported
        roles={[role(), other]}
        members={[member("u-2", "Jan", "role-crew")]}
        onAssignRole={onAssignRole}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Rola osoby Jan" }), other.id);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Rola osoby Jan" })).toHaveValue("role-crew");
  });

  it("shows when each person joined", () => {
    render(
      <MembersPane
        supported
        roles={[role()]}
        members={[member("u-2", "Jan", "role-crew")]}
        onAssignRole={vi.fn()}
      />,
    );

    expect(screen.getByText(/15\.01\.2026/)).toBeVisible();
  });
});

describe("InvitesPane expiry", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  function invite(id: string, expiresAt: string | null, overrides: Partial<Invite> = {}): Invite {
    return {
      id,
      url: `https://stellarr.test/i/${id}`,
      createdByName: "Maja",
      uses: 1,
      maxUses: 5,
      expiresAt,
      ...overrides,
    };
  }

  it("counts down in the coarsest unit that fits", () => {
    const now = new Date(2026, 7, 6, 12);
    vi.setSystemTime(now);
    const later = (ms: number) => new Date(now.getTime() + ms).toISOString();
    render(
      <InvitesPane
        supported
        invites={[
          invite("never", null, { maxUses: null, uses: 0 }),
          invite("past", later(-1000)),
          invite("minutes", later(30 * 60_000)),
          invite("hours", later(5 * 3_600_000)),
          invite("days", later(6 * 86_400_000)),
        ]}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    const detail = (id: string) =>
      screen.getByText(`https://stellarr.test/i/${id}`).nextElementSibling?.textContent;
    expect(detail("never")).toBe("Maja · użycia 0 / ∞ · wygasa nigdy");
    expect(detail("past")).toBe("Maja · użycia 1 / 5 · wygasło");
    expect(detail("minutes")).toBe("Maja · użycia 1 / 5 · wygasa za 30 min");
    expect(detail("hours")).toBe("Maja · użycia 1 / 5 · wygasa za 5 godz.");
    expect(detail("days")).toBe("Maja · użycia 1 / 5 · wygasa za 6 dni");
  });

  it("says so when creating or revoking fails, and locks the buttons meanwhile", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    let fail: (reason: Error) => void = () => {};
    const onCreate = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    render(
      <InvitesPane supported invites={[invite("a", null)]} onCreate={onCreate} onRevoke={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Nowy link" }));
    expect(screen.getByRole("button", { name: "Nowy link" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Unieważnij zaproszenie https://stellarr.test/i/a" }),
    ).toBeDisabled();

    fail(new Error("offline"));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Nowy link" })).toBeEnabled();
  });

  it("does not claim a copy when the clipboard refuses", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<InvitesPane supported invites={[invite("a", null)]} onCreate={vi.fn()} onRevoke={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Kopiuj zaproszenie https://stellarr.test/i/a" }));

    expect(screen.getByRole("button", { name: "Kopiuj zaproszenie https://stellarr.test/i/a" })).toHaveTextContent(
      "Kopiuj",
    );
  });
});

describe("DangerPane", () => {
  it("says so when an owner action fails and re-enables the buttons", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn().mockRejectedValue(new Error("no"));
    render(<DangerPane supported serverName="Orbit" onTransfer={onTransfer} onDelete={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Przekaż" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "Usuń Orbit" })).toBeEnabled();
  });

  it("disables both actions without the owner's permission", () => {
    render(<DangerPane supported={false} serverName="Orbit" onTransfer={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Przekaż" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Usuń Orbit" })).toBeDisabled();
  });
});
