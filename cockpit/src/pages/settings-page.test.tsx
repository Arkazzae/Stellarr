import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CockpitApiError, cockpitApi, type CockpitSettings } from "@/lib/api";
import { SettingsPage } from "@/pages/settings-page";
import { CockpitContext, type CockpitContextValue } from "@/state/cockpit-context";
import { selectPolish } from "@/test/locale";
import { cockpitValue } from "@/test/cockpit-fixtures";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    cockpitApi: { ...original.cockpitApi, settings: vi.fn(), updateSettings: vi.fn(), sendTestMail: vi.fn() },
  };
});

// Radix switches measure themselves with a ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const settingsMock = vi.mocked(cockpitApi.settings);
const updateMock = vi.mocked(cockpitApi.updateSettings);
const testMailMock = vi.mocked(cockpitApi.sendTestMail);

const stored: CockpitSettings = {
  instanceName: "Domek",
  publicUrl: "https://domek.example.net",
  timeZone: "Europe/Warsaw",
  mailingEnabled: true,
  mailProvider: "resend",
  mailFromAddress: "stellarr@example.net",
  resendApiKeyConfigured: true,
  inviteMailEnabled: true,
  recoveryMailEnabled: true,
  alertMailEnabled: false,
  backupRetentionDays: 14,
  logRetentionDays: 30,
  orphanObjectRetentionDays: 7,
  automaticCleanupEnabled: true,
  updatedAt: "2025-03-01T10:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function renderLoaded(settings: CockpitSettings = stored, context: CockpitContextValue = cockpitValue()) {
  settingsMock.mockResolvedValue(settings);
  render(
    <CockpitContext.Provider value={context}>
      <SettingsPage />
    </CockpitContext.Provider>,
  );
  await screen.findByLabelText("Nazwa instancji");
  return context;
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const toggle = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

async function replaceText(label: string, text: string) {
  await userEvent.clear(input(label));
  await userEvent.type(input(label), text);
}

beforeEach(() => {
  settingsMock.mockReset();
  updateMock.mockReset();
  testMailMock.mockReset();
});

describe("SettingsPage loading", () => {
  it("waits for the settings with the save button disabled", () => {
    settingsMock.mockReturnValue(new Promise(() => {}));
    render(
      <CockpitContext.Provider value={cockpitValue()}>
        <SettingsPage />
      </CockpitContext.Provider>,
    );

    expect(screen.getByRole("status").textContent).toContain("Wczytywanie ustawień");
    expect(button("Zapisz ustawienia").disabled).toBe(true);
    expect(screen.queryByLabelText("Nazwa instancji")).toBeNull();
  });

  it("shows why the settings could not be read", async () => {
    settingsMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(
      <CockpitContext.Provider value={cockpitValue()}>
        <SettingsPage />
      </CockpitContext.Provider>,
    );

    expect(await screen.findByText("Nie udało się pobrać ustawień")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(button("Zapisz ustawienia").disabled).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reads the settings once and shows them in the form", async () => {
    await renderLoaded();

    expect(settingsMock).toHaveBeenCalledOnce();
    expect(input("Nazwa instancji").value).toBe("Domek");
    expect(input("Publiczny adres").value).toBe("https://domek.example.net");
    expect(input("Strefa czasowa serwera").value).toBe("Europe/Warsaw");
    expect(input("Backupy, dni").value).toBe("14");
    expect(input("Logi, dni").value).toBe("30");
    expect(input("Obiekty, dni").value).toBe("7");
    expect(input("Adres nadawcy").value).toBe("stellarr@example.net");
    expect(toggle("Automatyczne sprzątanie").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Włącz mailing").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Zaproszenia").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Alerty operacyjne").getAttribute("aria-checked")).toBe("false");
    expect(button("Zapisz ustawienia").disabled).toBe(false);
  });

  it("tells whether the mail key is configured", async () => {
    await renderLoaded({ ...stored, resendApiKeyConfigured: false });

    expect(screen.getByText("Brak sekretu")).toBeTruthy();
    expect(screen.queryByText("Skonfigurowany")).toBeNull();
  });
});

describe("SettingsPage saving", () => {
  it("sends the edited settings, shows the stored result and refreshes the shell", async () => {
    const context = await renderLoaded();
    const reply = deferred<CockpitSettings>();
    updateMock.mockReturnValue(reply.promise);
    await replaceText("Nazwa instancji", "Nowy dom");
    await replaceText("Backupy, dni", "30");
    await userEvent.click(toggle("Alerty operacyjne"));

    await userEvent.click(button("Zapisz ustawienia"));

    expect(updateMock).toHaveBeenCalledExactlyOnceWith({
      ...stored,
      instanceName: "Nowy dom",
      backupRetentionDays: 30,
      alertMailEnabled: true,
    });
    expect(button("Zapisywanie").disabled).toBe(true);
    expect(context.reload).not.toHaveBeenCalled();

    reply.resolve({ ...stored, instanceName: "Nowy dom (zapisano)", backupRetentionDays: 30, alertMailEnabled: true });

    expect(await screen.findByText("Ustawienia zapisane")).toBeTruthy();
    expect(input("Nazwa instancji").value).toBe("Nowy dom (zapisano)");
    expect(context.reload).toHaveBeenCalledOnce();
    expect(button("Zapisz ustawienia").disabled).toBe(false);
    expect(settingsMock).toHaveBeenCalledOnce();
  });

  it("builds the next save on the stored result, not on the first read", async () => {
    await renderLoaded();
    updateMock.mockResolvedValue({ ...stored, publicUrl: "https://domek.example.net/" });
    await userEvent.click(button("Zapisz ustawienia"));
    await screen.findByText("Ustawienia zapisane");

    await replaceText("Strefa czasowa serwera", "UTC");
    await userEvent.click(button("Zapisz ustawienia"));

    expect(updateMock).toHaveBeenLastCalledWith({
      ...stored,
      publicUrl: "https://domek.example.net/",
      timeZone: "UTC",
    });
  });

  it("clears the saved notice as soon as something is edited again", async () => {
    await renderLoaded();
    updateMock.mockResolvedValue(stored);
    await userEvent.click(button("Zapisz ustawienia"));
    await screen.findByText("Ustawienia zapisane");

    await userEvent.type(input("Nazwa instancji"), "!");

    expect(screen.queryByText("Ustawienia zapisane")).toBeNull();
  });

  it("shows the server's messages under the fields they belong to", async () => {
    const context = await renderLoaded();
    updateMock.mockRejectedValue(
      new CockpitApiError(400, "Ustawienia są niepoprawne.", {
        instanceName: ["Nazwa jest wymagana.", "Druga uwaga."],
        publicUrl: ["Adres musi być bezwzględny."],
        timeZone: ["Nieznana strefa."],
        mailFromAddress: ["Adres nadawcy jest niepoprawny."],
        backupRetentionDays: ["Wartość spoza zakresu."],
        logRetentionDays: ["Za mało dni."],
        orphanObjectRetentionDays: ["Za dużo dni."],
      }),
    );

    await userEvent.click(button("Zapisz ustawienia"));

    expect(await screen.findByText("Ustawienia nie zostały zapisane")).toBeTruthy();
    expect(screen.getByText("Ustawienia są niepoprawne.")).toBeTruthy();
    expect(screen.getByText("Nazwa jest wymagana.")).toBeTruthy();
    expect(screen.queryByText("Druga uwaga.")).toBeNull();
    for (const [label, message] of [
      ["Nazwa instancji", "Nazwa jest wymagana."],
      ["Publiczny adres", "Adres musi być bezwzględny."],
      ["Strefa czasowa serwera", "Nieznana strefa."],
      ["Adres nadawcy", "Adres nadawcy jest niepoprawny."],
      ["Backupy, dni", "Wartość spoza zakresu."],
      ["Logi, dni", "Za mało dni."],
      ["Obiekty, dni", "Za dużo dni."],
    ] as const) {
      const field = input(label);
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(field.parentElement?.textContent).toContain(message);
    }
    expect(screen.queryByText("Ustawienia zapisane")).toBeNull();
    expect(context.reload).not.toHaveBeenCalled();
  });

  it("keeps the edits after a refusal and drops the messages once the next edit is made", async () => {
    await renderLoaded();
    updateMock.mockRejectedValue(
      new CockpitApiError(400, "Ustawienia są niepoprawne.", { instanceName: ["Nazwa jest wymagana."] }),
    );
    await replaceText("Nazwa instancji", "x");
    await userEvent.click(button("Zapisz ustawienia"));
    await screen.findByText("Nazwa jest wymagana.");
    expect(input("Nazwa instancji").value).toBe("x");

    await userEvent.type(input("Nazwa instancji"), "y");

    expect(screen.queryByText("Nazwa jest wymagana.")).toBeNull();
    expect(screen.queryByText("Ustawienia nie zostały zapisane")).toBeNull();
    expect(input("Nazwa instancji").getAttribute("aria-invalid")).toBe("false");
    expect(input("Nazwa instancji").value).toBe("xy");
  });

  it("explains a save failure that carries no message", async () => {
    await renderLoaded();
    updateMock.mockRejectedValue("boom");

    await userEvent.click(button("Zapisz ustawienia"));

    expect(await screen.findByText("Nie udało się zapisać ustawień.")).toBeTruthy();
  });
});

describe("SettingsPage mail", () => {
  it("turns the sender and the mail toggles off together with mailing", async () => {
    await renderLoaded();
    expect(input("Adres nadawcy").disabled).toBe(false);

    await userEvent.click(toggle("Włącz mailing"));

    expect(input("Adres nadawcy").disabled).toBe(true);
    for (const name of ["Zaproszenia", "Odzyskiwanie konta", "Alerty operacyjne"]) {
      expect(toggle(name).disabled).toBe(true);
    }
    expect(input("Odbiorca testu").disabled).toBe(true);
    expect(button("Wyślij test").disabled).toBe(true);
    expect(toggle("Włącz mailing").disabled).toBe(false);
    expect(toggle("Automatyczne sprzątanie").disabled).toBe(false);
  });

  it("starts with mailing off and nothing enabled for mail", async () => {
    await renderLoaded({ ...stored, mailingEnabled: false });

    expect(input("Adres nadawcy").disabled).toBe(true);
    expect(toggle("Zaproszenia").disabled).toBe(true);
    expect(button("Wyślij test").disabled).toBe(true);
  });

  it("sends the test mail to the default recipient and reports the message id", async () => {
    await renderLoaded();
    expect(input("Odbiorca testu").value).toBe("delivered+stellarr@resend.dev");
    const reply = deferred<{ id: string }>();
    testMailMock.mockReturnValue(reply.promise);

    await userEvent.click(button("Wyślij test"));

    expect(testMailMock).toHaveBeenCalledExactlyOnceWith("delivered+stellarr@resend.dev");
    expect(button("Wysyłanie").disabled).toBe(true);
    expect(input("Odbiorca testu").disabled).toBe(true);

    reply.resolve({ id: "msg-42" });

    expect((await screen.findByRole("status")).textContent).toBe("Resend przyjął wiadomość. ID: msg-42");
    expect(button("Wyślij test").disabled).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("trims the recipient and replaces an earlier result", async () => {
    await renderLoaded();
    testMailMock.mockResolvedValueOnce({ id: "msg-1" }).mockResolvedValueOnce({ id: "msg-2" });
    await userEvent.click(button("Wyślij test"));
    await screen.findByText("Resend przyjął wiadomość. ID: msg-1");

    await replaceText("Odbiorca testu", "  ja@example.net ");
    await userEvent.click(button("Wyślij test"));

    expect(await screen.findByText("Resend przyjął wiadomość. ID: msg-2")).toBeTruthy();
    expect(screen.queryByText("Resend przyjął wiadomość. ID: msg-1")).toBeNull();
    expect(testMailMock).toHaveBeenLastCalledWith("ja@example.net");
  });

  it("shows why the test mail was not sent", async () => {
    await renderLoaded();
    testMailMock.mockRejectedValue(new Error("Resend odrzucił klucz."));

    await userEvent.click(button("Wyślij test"));

    expect((await screen.findByRole("alert")).textContent).toBe("Resend odrzucił klucz.");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains a test mail failure that carries no message", async () => {
    await renderLoaded();
    testMailMock.mockRejectedValue("boom");

    await userEvent.click(button("Wyślij test"));

    expect(await screen.findByText("Nie udało się wysłać wiadomości testowej.")).toBeTruthy();
  });

  it("cannot send a test while the mail key is missing", async () => {
    await renderLoaded({ ...stored, resendApiKeyConfigured: false });
    expect(button("Wyślij test").disabled).toBe(true);
  });

  it("cannot send a test to an empty recipient", async () => {
    await renderLoaded();

    await userEvent.clear(input("Odbiorca testu"));
    expect(button("Wyślij test").disabled).toBe(true);

    await userEvent.type(input("Odbiorca testu"), "   ");
    expect(button("Wyślij test").disabled).toBe(true);
  });
});
