import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/app-shell";
import { CockpitContext, type CockpitContextValue } from "@/state/cockpit-context";
import { selectPolish } from "@/test/locale";
import { cockpitValue } from "@/test/cockpit-fixtures";

function renderShell(path: string, value: CockpitContextValue = cockpitValue(), basename?: string) {
  return render(
    <MemoryRouter initialEntries={[path]} basename={basename}>
      <CockpitContext.Provider value={value}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<p>Treść strony</p>} />
          </Route>
        </Routes>
      </CockpitContext.Provider>
    </MemoryRouter>,
  );
}

/** jsdom applies no style sheet, so the fixed sidebar is always there; the first navigation is its. */
function sidebarNavigation() {
  const [navigation] = screen.getAllByRole("navigation", { name: "Nawigacja Cockpitu" });
  if (!navigation) throw new Error("no navigation rendered");
  return navigation;
}

function activeLinks() {
  return within(sidebarNavigation())
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

selectPolish();

describe("AppShell navigation", () => {
  it("lists the six areas of the panel in order", () => {
    renderShell("/");

    const labels = within(sidebarNavigation())
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "Przegląd",
      "Użytkownicy",
      "Runtime",
      "Logi i audyt",
      "Backup",
      "Ustawienia",
    ]);
  });

  it("renders the routed page", () => {
    renderShell("/users");

    expect(screen.getByRole("main").textContent).toBe("Treść strony");
  });

  it.each([
    ["/", "Przegląd"],
    ["/users", "Użytkownicy"],
    ["/users/user-1", "Użytkownicy"],
    ["/runtime", "Runtime"],
    ["/logs", "Logi i audyt"],
    ["/backups", "Backup"],
    ["/settings", "Ustawienia"],
  ])("marks the item for %s as the only active one and names it in the header", (path, label) => {
    renderShell(path);

    expect(activeLinks()).toEqual([label]);
    expect(within(screen.getByRole("banner")).getByText(label)).toBeTruthy();
  });

  it("matches the root exactly, so an unknown page marks nothing and keeps the product name", () => {
    renderShell("/missing");

    expect(activeLinks()).toEqual([]);
    expect(within(screen.getByRole("banner")).getByText("Stellarr Cockpit")).toBeTruthy();
  });

  it("shows the instance name in the header", () => {
    renderShell("/");

    expect(within(screen.getByRole("banner")).getByText("Domek")).toBeTruthy();
  });
});

describe("AppShell mobile navigation", () => {
  it("opens the same navigation in a sheet and closes it once a link is followed", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("button", { name: "Otwórz nawigację" }));
    const sheet = await screen.findByRole("dialog");
    const sheetLinks = within(sheet).getAllByRole("link");
    expect(sheetLinks).toHaveLength(6);

    await user.click(within(sheet).getByRole("link", { name: "Runtime" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(screen.getByRole("banner")).getByText("Runtime")).toBeTruthy();
  });
});

describe("AppShell operator menu", () => {
  it("shows who is signed in", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("button", { name: /Ola/ }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Ola Owner")).toBeTruthy();
    expect(within(menu).getByText("@owner")).toBeTruthy();
  });

  it("leaves the panel's router base for the app", async () => {
    const user = userEvent.setup();
    renderShell("/cockpit/users", cockpitValue(), "/cockpit");

    await user.click(screen.getByRole("button", { name: /Ola/ }));

    const toApp = await screen.findByRole("menuitem", { name: "Przejdź do aplikacji" });
    // A router link would resolve to /cockpit/ under this base.
    expect(toApp.getAttribute("href")).toBe("/");
  });

  it("logs out through the session", async () => {
    const user = userEvent.setup();
    const value = cockpitValue();
    renderShell("/", value);

    await user.click(screen.getByRole("button", { name: /Ola/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Wyloguj się" }));

    expect(value.logout).toHaveBeenCalledOnce();
  });
});
