import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { opsApi, type OpsRole, type OpsSession, type OpsUser } from "@/lib/api";
import { UsersPage } from "@/pages/users-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    opsApi: {
      ...original.opsApi,
      users: vi.fn(),
      sessions: vi.fn(),
      createUser: vi.fn(),
      setUserRole: vi.fn(),
      setUserDisabled: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      revokeSession: vi.fn(),
      requestPasswordReset: vi.fn(),
    },
  };
});

const api = vi.mocked(opsApi);
const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const allPermissions = [
  "manageServer",
  "manageChannels",
  "manageRoles",
  "manageMembers",
  "manageMessages",
  "moderateMembers",
  "manageBans",
  "viewAuditLog",
];

function role(overrides: Partial<OpsRole> & Pick<OpsRole, "id" | "name">): OpsRole {
  return {
    color: "#64748b",
    permissions: [],
    memberCount: 0,
    isSystem: false,
    isOwner: false,
    ...overrides,
  };
}

function account(overrides: Partial<OpsUser> & Pick<OpsUser, "id" | "username" | "displayName">): OpsUser {
  return {
    email: null,
    avatarColor: "#123456",
    avatarUrl: null,
    presence: "offline",
    realtimeConnections: 0,
    roleId: "role-member",
    roleName: "Członek",
    isDisabled: false,
    joinedAt: "2025-02-03T09:30:00Z",
    createdAt: "2025-02-03T09:30:00Z",
    ...overrides,
  };
}

function session(overrides: Partial<OpsSession> & Pick<OpsSession, "id" | "userDisplayName">): OpsSession {
  return {
    userId: "u-ola",
    device: "Firefox na Linuksie",
    clientName: null,
    clientVersion: null,
    clientRuntime: null,
    installType: null,
    ipAddress: "10.0.0.5",
    createdAt: "2025-03-01T08:00:00Z",
    lastSeenAt: "2025-03-04T10:15:00Z",
    expiresAt: "2025-04-01T08:00:00Z",
    current: false,
    ...overrides,
  };
}

const owner = role({
  id: "role-owner",
  name: "Właściciel",
  isSystem: true,
  isOwner: true,
  permissions: allPermissions,
  memberCount: 1,
});
const member = role({ id: "role-member", name: "Członek", isSystem: true, memberCount: 2 });
const moderator = role({
  id: "role-mod",
  name: "Moderator",
  color: "#ff8800",
  permissions: ["manageMessages", "moderateMembers"],
  memberCount: 1,
});
const deputy = role({ id: "role-deputy", name: "Zastępca właściciela", memberCount: 1 });
const roles = [owner, member, moderator, deputy];

const ola = account({
  id: "u-ola",
  username: "ola",
  displayName: "Ola Owner",
  email: "ola@example.net",
  roleId: owner.id,
  roleName: owner.name,
  presence: "online",
  realtimeConnections: 2,
});
const ben = account({ id: "u-ben", username: "ben_k", displayName: "Ben Kowalski", presence: "idle" });
const cleo = account({
  id: "u-cleo",
  username: "cleo",
  displayName: "Cleo Nowak",
  email: "cleo@example.net",
  roleId: moderator.id,
  roleName: moderator.name,
  presence: "dnd",
  isDisabled: false,
});
const dawid = account({
  id: "u-dawid",
  username: "dawid",
  displayName: "Dawid Zastępca",
  roleId: deputy.id,
  roleName: deputy.name,
});
const lucja = account({ id: "u-lucja", username: "lnowak", displayName: "Łucja Nowak" });
const users = [ola, ben, cleo, dawid, lucja];

const ownSession = session({ id: "s-own", userDisplayName: "Ola Owner", current: true });
const desktopSession = session({
  id: "s-desktop",
  userId: "u-ben",
  userDisplayName: "Ben Kowalski",
  clientName: "Stellarr Desktop",
  clientVersion: "0.4.1",
  clientRuntime: "Tauri",
  installType: "Arch",
  ipAddress: "10.0.0.9",
});
const sessions = [ownSession, desktopSession];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function renderLoaded(data: { users?: OpsUser[]; roles?: OpsRole[]; sessions?: OpsSession[] } = {}) {
  api.users.mockResolvedValue({
    users: data.users ?? users,
    roles: data.roles ?? roles,
    sessionRegistryAvailable: true,
  });
  api.sessions.mockResolvedValue(data.sessions ?? sessions);
  const view = render(<UsersPage />);
  await screen.findByRole("tab", { name: /^Sesje/ });
  return view;
}

const rowOf = (name: string) => screen.getByRole("row", { name: new RegExp(name) });
const menuOf = async (displayName: string) => {
  await userEvent.click(screen.getByRole("button", { name: `Akcje dla ${displayName}` }));
  return screen.findByRole("menu");
};
const itemNames = (menu: HTMLElement) =>
  within(menu).getAllByRole("menuitem").map((item) => item.textContent);
const isDisabled = (element: HTMLElement) => element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  for (const mock of Object.values(api)) if (vi.isMockFunction(mock)) mock.mockReset();
});

describe("UsersPage loading", () => {
  it("reads accounts and sessions once, together, and shows a spinner meanwhile", async () => {
    const pending = deferred<never[]>();
    api.users.mockResolvedValue({ users, roles, sessionRegistryAvailable: true });
    api.sessions.mockReturnValue(pending.promise);

    render(<UsersPage />);

    expect(screen.getByRole("status").textContent).toContain("Wczytywanie danych");
    expect(screen.queryByRole("tab", { name: "Role" })).toBeNull();
    expect(api.users).toHaveBeenCalledOnce();
    expect(api.sessions).toHaveBeenCalledOnce();

    pending.resolve([]);

    expect(await screen.findByRole("tab", { name: "Sesje (0)" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows why the data could not be read", async () => {
    api.users.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    api.sessions.mockResolvedValue([]);

    render(<UsersPage />);

    expect(await screen.findByText("Nie udało się pobrać danych")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Role" })).toBeNull();
  });

  it("explains a read failure that carries no message", async () => {
    api.users.mockRejectedValue("boom");
    api.sessions.mockResolvedValue([]);

    render(<UsersPage />);

    expect(await screen.findByText("Nie udało się pobrać danych.")).toBeTruthy();
  });
});

describe("UsersPage accounts", () => {
  it("lists each account with its handle, role, presence, connections and join date", async () => {
    await renderLoaded();

    const row = rowOf("Ola Owner");
    expect(row.textContent).toContain("@ola · ola@example.net");
    expect(within(row).getByText("Właściciel")).toBeTruthy();
    expect(within(row).getByText("● W sieci")).toBeTruthy();
    expect(within(row).getByText("2")).toBeTruthy();
    expect(within(row).getByText(formatDateTime(ola.joinedAt))).toBeTruthy();
    expect(rowOf("Ben Kowalski").textContent).toContain("@ben_k");
    expect(rowOf("Ben Kowalski").textContent).not.toContain("·");
    expect(within(rowOf("Ben Kowalski")).getByText("◐ Zaraz wracam")).toBeTruthy();
    expect(within(rowOf("Cleo Nowak")).getByText("■ Nie przeszkadzać")).toBeTruthy();
    expect(within(rowOf("Dawid")).getByText("○ Poza siecią")).toBeTruthy();
    expect(screen.getByText("5 kont w instancji.")).toBeTruthy();
  });

  it("shows a disabled account as disabled instead of by its presence", async () => {
    await renderLoaded({ users: [{ ...ola, isDisabled: true }, ben] });

    const row = rowOf("Ola Owner");
    expect(within(row).getByText("Wyłączone")).toBeTruthy();
    expect(within(row).queryByText("● W sieci")).toBeNull();
  });

  it("filters by display name or username, ignoring case, also of Polish letters", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const search = screen.getByRole("textbox", { name: "Szukaj użytkownika" });

    await user.type(search, "ŁUC");
    expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Użytkownik"),
      expect.stringContaining("Łucja Nowak"),
    ]);

    await user.clear(search);
    await user.type(search, "  BEN_K ");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(rowOf("Ben Kowalski")).toBeTruthy();
  });

  it("combines the search with the role filter and says when nothing matches", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    const search = screen.getByRole("textbox", { name: "Szukaj użytkownika" });
    const roleFilter = screen.getByRole("combobox", { name: "Filtruj według roli" });

    await user.selectOptions(roleFilter, moderator.id);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(rowOf("Cleo Nowak")).toBeTruthy();

    await user.type(search, "ben");
    expect(screen.getByText("Brak wyników.")).toBeTruthy();

    await user.clear(search);
    await user.type(search, "nowak");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(rowOf("Cleo Nowak")).toBeTruthy();

    await user.selectOptions(roleFilter, "");
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("keeps the filter while another tab is open", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(screen.getByRole("textbox", { name: "Szukaj użytkownika" }), "cleo");

    await user.click(screen.getByRole("tab", { name: "Role" }));
    await user.click(screen.getByRole("tab", { name: "Użytkownicy" }));

    expect((screen.getByRole("textbox", { name: "Szukaj użytkownika" }) as HTMLInputElement).value).toBe("cleo");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
});

describe("UsersPage row menu", () => {
  it("offers a password reset only to an account with an e-mail", async () => {
    await renderLoaded();

    const withMail = await menuOf("Cleo Nowak");
    expect(isDisabled(within(withMail).getByRole("menuitem", { name: "Wyślij reset hasła" }))).toBe(false);
    await userEvent.keyboard("{Escape}");

    const withoutMail = await menuOf("Ben Kowalski");
    expect(isDisabled(within(withoutMail).getByRole("menuitem", { name: "Wyślij reset hasła" }))).toBe(true);
  });

  it("requests the reset for the account's e-mail and reads the lists again", async () => {
    await renderLoaded();
    api.requestPasswordReset.mockResolvedValue(undefined);

    const menu = await menuOf("Cleo Nowak");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Wyślij reset hasła" }));

    expect(await screen.findByText("Wysłano żądanie zmiany hasła dla Cleo Nowak.")).toBeTruthy();
    expect(api.requestPasswordReset).toHaveBeenCalledExactlyOnceWith("cleo@example.net");
    expect(screen.getByText("Gotowe")).toBeTruthy();
    expect(api.users).toHaveBeenCalledTimes(2);
    expect(api.sessions).toHaveBeenCalledTimes(2);
  });

  it("offers the other roles that are not owner roles, and none to an owner", async () => {
    await renderLoaded();

    const memberMenu = await menuOf("Ben Kowalski");
    expect(itemNames(memberMenu)).toEqual([
      "Wyślij reset hasła",
      "Moderator",
      "Zastępca właściciela",
      "Wyłącz konto",
    ]);
    await userEvent.keyboard("{Escape}");

    const ownerMenu = await menuOf("Ola Owner");
    expect(itemNames(ownerMenu)).toEqual(["Wyślij reset hasła", "Wyłącz konto"]);
    expect(within(ownerMenu).queryByText("Zmień rolę")).toBeNull();
  });

  it("blocks disabling an owner", async () => {
    await renderLoaded();

    const menu = await menuOf("Ola Owner");

    expect(isDisabled(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }))).toBe(true);
  });

  it("does not treat a role as owner because of its name", async () => {
    await renderLoaded();

    const menu = await menuOf("Dawid Zastępca");

    expect(itemNames(menu)).toEqual(["Wyślij reset hasła", "Członek", "Moderator", "Wyłącz konto"]);
    expect(isDisabled(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }))).toBe(false);
  });

  it("treats any role with the owner flag as owner, whatever it is called", async () => {
    const chief = role({ id: "role-chief", name: "Szef", isOwner: true });
    const eve = account({ id: "u-eve", username: "eve", displayName: "Ewa Szef", roleId: chief.id, roleName: chief.name });
    await renderLoaded({ users: [eve], roles: [member, chief] });

    const menu = await menuOf("Ewa Szef");

    expect(itemNames(menu)).toEqual(["Wyślij reset hasła", "Wyłącz konto"]);
    expect(isDisabled(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }))).toBe(true);
  });

  it("assigns the chosen role and shows the new assignment after the lists are read again", async () => {
    await renderLoaded();
    api.setUserRole.mockResolvedValue(undefined);
    api.users.mockResolvedValue({
      users: [ola, { ...ben, roleId: moderator.id, roleName: moderator.name }],
      roles,
      sessionRegistryAvailable: true,
    });

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Moderator" }));

    expect(await screen.findByText("Przypisano rolę Moderator.")).toBeTruthy();
    expect(api.setUserRole).toHaveBeenCalledExactlyOnceWith("u-ben", "role-mod");
    expect(within(rowOf("Ben Kowalski")).getByText("Moderator")).toBeTruthy();
  });

  it("disables an enabled account", async () => {
    await renderLoaded();
    api.setUserDisabled.mockResolvedValue(undefined);

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }));

    expect(await screen.findByText("Wyłączono konto Ben Kowalski i jego sesje.")).toBeTruthy();
    expect(api.setUserDisabled).toHaveBeenCalledExactlyOnceWith("u-ben", true);
  });

  it("enables a disabled account", async () => {
    await renderLoaded({ users: [{ ...ben, isDisabled: true }] });
    api.setUserDisabled.mockResolvedValue(undefined);

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Włącz konto" }));

    expect(await screen.findByText("Włączono konto Ben Kowalski.")).toBeTruthy();
    expect(api.setUserDisabled).toHaveBeenCalledExactlyOnceWith("u-ben", false);
  });

  it("locks the menu while an action runs", async () => {
    await renderLoaded();
    const change = deferred<void>();
    api.setUserDisabled.mockReturnValue(change.promise);

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }));

    const trigger = screen.getByRole("button", { name: "Akcje dla Ben Kowalski" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    change.resolve();

    expect(await screen.findByText("Wyłączono konto Ben Kowalski i jego sesje.")).toBeTruthy();
    expect(trigger.disabled).toBe(false);
  });

  it("shows why an action failed and does not read the lists again", async () => {
    await renderLoaded();
    api.setUserRole.mockRejectedValue(new Error("Rola nie istnieje."));

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Moderator" }));

    expect(await screen.findByText("Rola nie istnieje.")).toBeTruthy();
    expect(screen.getByText("Błąd")).toBeTruthy();
    expect(screen.queryByText("Gotowe")).toBeNull();
    expect(api.users).toHaveBeenCalledOnce();
  });

  it("reports a change as failed when the lists cannot be read again afterwards", async () => {
    await renderLoaded();
    api.setUserDisabled.mockResolvedValue(undefined);
    api.sessions.mockRejectedValueOnce(new Error("Backend odpowiedział kodem 500."));

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }));

    expect(await screen.findByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(screen.getByText("Błąd")).toBeTruthy();
    expect(screen.queryByText("Gotowe")).toBeNull();
    expect(screen.queryByText("Nie udało się pobrać danych")).toBeNull();
    expect(rowOf("Ben Kowalski")).toBeTruthy();
  });

  it("explains an action failure that carries no message", async () => {
    await renderLoaded();
    api.setUserDisabled.mockRejectedValue("boom");

    const menu = await menuOf("Ben Kowalski");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Wyłącz konto" }));

    expect(await screen.findByText("Operacja nie powiodła się.")).toBeTruthy();
  });
});

describe("UsersPage sessions", () => {
  async function openSessions() {
    const view = await renderLoaded();
    await userEvent.click(screen.getByRole("tab", { name: "Sesje (2)" }));
    return view;
  }

  it("counts the sessions in the tab and lists them with their client", async () => {
    await openSessions();

    const plain = rowOf("Firefox na Linuksie");
    expect(plain.textContent).toContain("10.0.0.5");
    expect(within(plain).getByText("—")).toBeTruthy();
    expect(within(plain).getByText(formatDateTime(ownSession.lastSeenAt))).toBeTruthy();
    expect(within(plain).getByText(formatDateTime(ownSession.expiresAt))).toBeTruthy();
    const desktop = rowOf("Stellarr Desktop");
    expect(within(desktop).getByText("Arch · Tauri")).toBeTruthy();
    expect(within(desktop).getByText("v0.4.1")).toBeTruthy();
  });

  it("marks the current session and does not let it be revoked", async () => {
    await openSessions();

    const own = rowOf("Ola Owner");
    expect(within(own).getByText("Ta sesja")).toBeTruthy();
    expect((within(own).getByRole("button", { name: "Unieważnij" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rowOf("Ben Kowalski")).queryByText("Ta sesja")).toBeNull();
  });

  it("revokes another session, reads the lists again and drops the session", async () => {
    await openSessions();
    api.revokeSession.mockResolvedValue(undefined);
    api.sessions.mockResolvedValue([ownSession]);

    await userEvent.click(within(rowOf("Ben Kowalski")).getByRole("button", { name: "Unieważnij" }));

    expect(await screen.findByText("Unieważniono sesję Ben Kowalski.")).toBeTruthy();
    expect(api.revokeSession).toHaveBeenCalledExactlyOnceWith("s-desktop");
    expect(api.users).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("tab", { name: "Sesje (1)" })).toBeTruthy();
    expect(screen.queryByText("Stellarr Desktop")).toBeNull();
  });

  it("shows why a session could not be revoked", async () => {
    await openSessions();
    api.revokeSession.mockRejectedValue("boom");

    await userEvent.click(within(rowOf("Ben Kowalski")).getByRole("button", { name: "Unieważnij" }));

    expect(await screen.findByText("Nie udało się unieważnić sesji.")).toBeTruthy();
    expect(api.sessions).toHaveBeenCalledOnce();
  });

  it("says when there are no sessions", async () => {
    await renderLoaded({ sessions: [] });
    await userEvent.click(screen.getByRole("tab", { name: "Sesje (0)" }));

    expect(screen.getByText("Brak aktywnych sesji.")).toBeTruthy();
  });
});

describe("UsersPage new account", () => {
  async function openForm() {
    const view = await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: "Dodaj użytkownika" }));
    const sheet = await screen.findByRole("dialog");
    return { ...view, sheet };
  }

  async function fillRequired(sheet: HTMLElement) {
    await userEvent.type(within(sheet).getByLabelText("Nazwa wyświetlana"), "Nowy Gość");
    await userEvent.type(within(sheet).getByLabelText("Login"), "gosc.1");
    await userEvent.type(within(sheet).getByLabelText("Hasło tymczasowe"), "tajne-haslo");
  }

  it("offers every role except the owner role", async () => {
    const { sheet } = await openForm();

    const options = within(within(sheet).getByLabelText("Rola")).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "Członek",
      "Moderator",
      "Zastępca właściciela",
    ]);
  });

  it("creates the account without an e-mail when none is given", async () => {
    const { sheet } = await openForm();
    api.createUser.mockResolvedValue({ id: "u-new" });
    await fillRequired(sheet);
    await userEvent.selectOptions(within(sheet).getByLabelText("Rola"), moderator.id);

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    expect(await screen.findByText("Utworzono konto użytkownika.")).toBeTruthy();
    expect(api.createUser).toHaveBeenCalledOnce();
    const input = api.createUser.mock.calls[0]![0];
    expect(input).toEqual({
      username: "gosc.1",
      displayName: "Nowy Gość",
      password: "tajne-haslo",
      roleId: "role-mod",
    });
    expect(input).not.toHaveProperty("email");
    expect(api.users).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends the e-mail when it is filled in", async () => {
    const { sheet } = await openForm();
    api.createUser.mockResolvedValue({ id: "u-new" });
    await fillRequired(sheet);
    await userEvent.type(within(sheet).getByLabelText("E-mail (opcjonalnie)"), "gosc@example.net");

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    await screen.findByText("Utworzono konto użytkownika.");
    expect(api.createUser.mock.calls[0]![0]).toMatchObject({ email: "gosc@example.net", roleId: "role-member" });
  });

  it("keeps the form open and shows the reason when the server refuses", async () => {
    const { sheet } = await openForm();
    api.createUser.mockRejectedValue(new Error("Login jest już zajęty."));
    await fillRequired(sheet);

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    expect(await screen.findByText("Login jest już zajęty.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(api.users).toHaveBeenCalledOnce();
    expect((within(sheet).getByRole("button", { name: "Utwórz konto" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the form open when the account is created but the lists cannot be read again", async () => {
    const { sheet } = await openForm();
    api.createUser.mockResolvedValue({ id: "u-new" });
    api.users.mockRejectedValueOnce(new Error("Backend odpowiedział kodem 500."));
    await fillRequired(sheet);

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    expect(await screen.findByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(api.createUser).toHaveBeenCalledOnce();
    expect(screen.queryByText("Gotowe")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("explains a creation failure that carries no message", async () => {
    const { sheet } = await openForm();
    api.createUser.mockRejectedValue("boom");
    await fillRequired(sheet);

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    expect(await screen.findByText("Nie udało się utworzyć konta.")).toBeTruthy();
  });

  it("does not send a login with characters the server would refuse", async () => {
    const { sheet } = await openForm();
    await userEvent.type(within(sheet).getByLabelText("Nazwa wyświetlana"), "Nowy Gość");
    await userEvent.type(within(sheet).getByLabelText("Login"), "zły login!");
    await userEvent.type(within(sheet).getByLabelText("Hasło tymczasowe"), "tajne-haslo");

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    expect(api.createUser).not.toHaveBeenCalled();
  });

  it("accepts a login with letters of any alphabet, dots, hyphens and underscores", async () => {
    const { sheet } = await openForm();
    api.createUser.mockResolvedValue({ id: "u-new" });
    await userEvent.type(within(sheet).getByLabelText("Nazwa wyświetlana"), "Żaneta Łoś");
    await userEvent.type(within(sheet).getByLabelText("Login"), "żaneta.łoś_2-b");
    await userEvent.type(within(sheet).getByLabelText("Hasło tymczasowe"), "tajne-haslo");

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    await screen.findByText("Utworzono konto użytkownika.");
    expect(api.createUser.mock.calls[0]![0]).toMatchObject({ username: "żaneta.łoś_2-b" });
  });

  it("shows a pending state while the account is being created", async () => {
    const { sheet } = await openForm();
    const creation = deferred<{ id: string }>();
    api.createUser.mockReturnValue(creation.promise);
    await fillRequired(sheet);

    await userEvent.click(within(sheet).getByRole("button", { name: "Utwórz konto" }));

    expect((within(sheet).getByRole("button", { name: "Tworzenie" }) as HTMLButtonElement).disabled).toBe(true);

    creation.resolve({ id: "u-new" });

    expect(await screen.findByText("Utworzono konto użytkownika.")).toBeTruthy();
  });
});

describe("UsersPage roles", () => {
  async function openRoles() {
    const view = await renderLoaded();
    await userEvent.click(screen.getByRole("tab", { name: "Role" }));
    return view;
  }

  it("lists each role with its members, permission count and kind", async () => {
    await openRoles();

    expect(within(rowOf("Właściciel")).getByText("8 uprawnień")).toBeTruthy();
    expect(within(rowOf("Właściciel")).getByText("Systemowa")).toBeTruthy();
    expect(within(rowOf("Moderator")).getByText("2 uprawnień")).toBeTruthy();
    expect(within(rowOf("Moderator")).getByText("Własna")).toBeTruthy();
    expect(within(rowOf("Członek")).getByText("Brak")).toBeTruthy();
    expect(within(rowOf("Członek")).getByText("2")).toBeTruthy();
  });

  it("lets every role but the owner role be edited", async () => {
    await openRoles();

    expect(within(rowOf("Właściciel")).queryByRole("button", { name: "Edytuj" })).toBeNull();
    expect(within(rowOf("Członek")).getByRole("button", { name: "Edytuj" })).toBeTruthy();
  });

  it("creates a role from the name, colour and ticked permissions", async () => {
    await openRoles();
    api.createRole.mockResolvedValue(role({ id: "role-new", name: "Pomocnik" }));

    await userEvent.click(screen.getByRole("button", { name: "Dodaj rolę" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Nowa rola")).toBeTruthy();
    expect(within(sheet).getAllByRole("checkbox").map((box) => (box as HTMLInputElement).checked)).toEqual(
      allPermissions.map(() => false),
    );
    await userEvent.type(within(sheet).getByLabelText("Nazwa"), "Pomocnik");
    await userEvent.clear(within(sheet).getByLabelText("Kolor CSS"));
    await userEvent.type(within(sheet).getByLabelText("Kolor CSS"), "tomato");
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "manageMessages" }));
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "viewAuditLog" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Zapisz rolę" }));

    expect(await screen.findByText("Utworzono rolę.")).toBeTruthy();
    expect(api.createRole).toHaveBeenCalledExactlyOnceWith({
      name: "Pomocnik",
      color: "tomato",
      permissions: ["manageMessages", "viewAuditLog"],
    });
    expect(api.updateRole).not.toHaveBeenCalled();
    expect(api.users).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens an existing role filled in and updates it", async () => {
    await openRoles();
    api.updateRole.mockResolvedValue(moderator);

    await userEvent.click(within(rowOf("Moderator")).getByRole("button", { name: "Edytuj" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Edytuj: Moderator")).toBeTruthy();
    expect((within(sheet).getByLabelText("Nazwa") as HTMLInputElement).value).toBe("Moderator");
    expect((within(sheet).getByLabelText("Kolor CSS") as HTMLInputElement).value).toBe("#ff8800");
    expect((within(sheet).getByRole("checkbox", { name: "moderateMembers" }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole("checkbox", { name: "manageBans" }) as HTMLInputElement).checked).toBe(false);
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "manageBans" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Zapisz rolę" }));

    expect(await screen.findByText("Zaktualizowano rolę.")).toBeTruthy();
    expect(api.updateRole).toHaveBeenCalledExactlyOnceWith("role-mod", {
      name: "Moderator",
      color: "#ff8800",
      permissions: ["manageMessages", "moderateMembers", "manageBans"],
    });
    expect(api.createRole).not.toHaveBeenCalled();
  });

  it("keeps the sheet open and shows the reason when the role cannot be saved", async () => {
    await openRoles();
    api.createRole.mockRejectedValue(new Error("Rola o tej nazwie już istnieje."));

    await userEvent.click(screen.getByRole("button", { name: "Dodaj rolę" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Nazwa"), "Moderator");
    await userEvent.click(within(sheet).getByRole("button", { name: "Zapisz rolę" }));

    expect(await screen.findByText("Rola o tej nazwie już istnieje.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(api.users).toHaveBeenCalledOnce();
  });

  it("explains a role failure that carries no message", async () => {
    await openRoles();
    api.createRole.mockRejectedValue("boom");

    await userEvent.click(screen.getByRole("button", { name: "Dodaj rolę" }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(within(sheet).getByLabelText("Nazwa"), "Pomocnik");
    await userEvent.click(within(sheet).getByRole("button", { name: "Zapisz rolę" }));

    expect(await screen.findByText("Nie udało się zapisać roli.")).toBeTruthy();
  });
});
