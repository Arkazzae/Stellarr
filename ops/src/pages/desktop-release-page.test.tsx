import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OpsApiError,
  opsApi,
  type OpsDesktopRelease,
  type OpsPublishedClientRelease,
} from "@/lib/api";
import { DesktopReleasePage } from "@/pages/desktop-release-page";
import { selectPolish } from "@/test/locale";

selectPolish();

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    opsApi: { ...original.opsApi, desktopRelease: vi.fn(), updateDesktopRelease: vi.fn() },
  };
});

const releaseMock = vi.mocked(opsApi.desktopRelease);
const updateMock = vi.mocked(opsApi.updateDesktopRelease);

const formatDate = (value: string) => new Date(value).toLocaleDateString("pl-PL");

const android: OpsPublishedClientRelease = {
  version: "0.4.2",
  publishedAt: "2025-03-04T10:00:00Z",
  notes: "Poprawki powiadomień.",
  platform: "android",
  architecture: "arm64-v8a",
  fileName: "stellarr-0.4.2.apk",
  sizeBytes: Math.round(24.46 * 1024 * 1024),
  sha256: "a".repeat(64),
  downloadUrl: "/api/client/releases/android",
};
const arch: OpsPublishedClientRelease = {
  version: "0.4.1",
  publishedAt: "2025-02-20T08:00:00Z",
  notes: "Nowy odtwarzacz.",
  platform: "arch",
  architecture: "x86_64",
  fileName: "stellarr-0.4.1-x86_64.pkg.tar.zst",
  sizeBytes: 700 * 1024,
  sha256: "b".repeat(64),
  downloadUrl: "/api/desktop/release/arch",
};

function release(overrides: Partial<OpsDesktopRelease> = {}): OpsDesktopRelease {
  return {
    minimumVersion: "0.3.0",
    recommendedVersion: "0.4.0",
    published: arch,
    androidPublished: android,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function renderLoaded(value: OpsDesktopRelease = release()) {
  releaseMock.mockResolvedValue(value);
  render(<DesktopReleasePage />);
  await screen.findByLabelText("Wersja minimalna");
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const saveButton = (name = "Zapisz wersje") => screen.getByRole("button", { name }) as HTMLButtonElement;
/** The block of one platform: the nearest ancestor of its title that also holds the download. */
const packageOf = (title: RegExp) => {
  const heading = screen.getByText(title);
  let block: HTMLElement | null = heading.parentElement;
  while (block && !block.querySelector("code")) block = block.parentElement;
  if (!block) throw new Error("no package block");
  return within(block);
};

async function replaceText(label: string, text: string) {
  await userEvent.clear(field(label));
  await userEvent.type(field(label), text);
}

beforeEach(() => {
  releaseMock.mockReset();
  updateMock.mockReset();
});

describe("DesktopReleasePage loading", () => {
  it("shows a spinner until the release is read", async () => {
    const reply = deferred<OpsDesktopRelease>();
    releaseMock.mockReturnValue(reply.promise);
    render(<DesktopReleasePage />);

    expect(screen.getByRole("status").textContent).toContain("Wczytywanie wydań");
    expect(screen.queryByLabelText("Wersja minimalna")).toBeNull();

    reply.resolve(release());

    expect(await screen.findByLabelText("Wersja minimalna")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("shows why the release could not be read", async () => {
    releaseMock.mockRejectedValue(new Error("Backend odpowiedział kodem 500."));
    render(<DesktopReleasePage />);

    expect(await screen.findByText("Nie udało się wczytać wydań")).toBeTruthy();
    expect(screen.getByText("Backend odpowiedział kodem 500.")).toBeTruthy();
    expect(screen.queryByLabelText("Wersja minimalna")).toBeNull();
  });

  it("explains a read failure that carries no message", async () => {
    releaseMock.mockRejectedValue("boom");
    render(<DesktopReleasePage />);

    expect(await screen.findByText("Nie udało się odczytać wydania.")).toBeTruthy();
  });
});

describe("DesktopReleasePage packages", () => {
  it("describes each published package and links its download", async () => {
    await renderLoaded();

    expect(screen.getByText("Opublikowano 2 z 2")).toBeTruthy();
    const apk = packageOf(/^Android/);
    expect(apk.getByText("v0.4.2")).toBeTruthy();
    expect(apk.getByText("stellarr-0.4.2.apk")).toBeTruthy();
    expect(apk.getByText(`ARM64 · 24.5 MB · ${formatDate(android.publishedAt)}`)).toBeTruthy();
    expect(apk.getByText("Poprawki powiadomień.")).toBeTruthy();
    expect(apk.getByText("a".repeat(64))).toBeTruthy();
    const apkLink = apk.getByRole("link", { name: "Pobierz APK" });
    expect(apkLink.getAttribute("href")).toBe("/api/client/releases/android");
    expect(apkLink.getAttribute("download")).toBe("stellarr-0.4.2.apk");

    const pkg = packageOf(/^Arch Linux/);
    expect(pkg.getByText("v0.4.1")).toBeTruthy();
    expect(pkg.getByText(`x86_64 · 700 KB · ${formatDate(arch.publishedAt)}`)).toBeTruthy();
    expect(pkg.getByText("b".repeat(64))).toBeTruthy();
    const pkgLink = pkg.getByRole("link", { name: "Pobierz paczkę" });
    expect(pkgLink.getAttribute("href")).toBe("/api/desktop/release/arch");
    expect(pkgLink.getAttribute("download")).toBe("stellarr-0.4.1-x86_64.pkg.tar.zst");
  });

  it("says which platform has no package and counts what is published", async () => {
    await renderLoaded(release({ androidPublished: null }));

    expect(screen.getByText("Opublikowano 1 z 2")).toBeTruthy();
    expect(screen.getByText("Brak opublikowanego wydania dla Android.")).toBeTruthy();
    expect(screen.queryByText("Brak opublikowanego wydania dla Arch Linux.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Pobierz APK" })).toBeNull();
    expect(screen.getByRole("link", { name: "Pobierz paczkę" })).toBeTruthy();
  });

  it("counts nothing as published when both are missing", async () => {
    await renderLoaded(release({ androidPublished: null, published: null }));

    expect(screen.getByText("Opublikowano 0 z 2")).toBeTruthy();
    expect(screen.getByText("Brak opublikowanego wydania dla Android.")).toBeTruthy();
    expect(screen.getByText("Brak opublikowanego wydania dla Arch Linux.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each([
    [0, "0 KB"],
    [1536, "2 KB"],
    [1024 * 1024 - 1, "1024 KB"],
    [1024 * 1024, "1.0 MB"],
    [Math.round(2.54 * 1024 * 1024), "2.5 MB"],
  ])("shows %d bytes as %s", async (sizeBytes, text) => {
    await renderLoaded(release({ published: { ...arch, sizeBytes } }));

    expect(packageOf(/^Arch Linux/).getByText(new RegExp(`x86_64 · ${text} ·`))).toBeTruthy();
  });
});

describe("DesktopReleasePage versions", () => {
  it("shows the stored versions", async () => {
    await renderLoaded();

    expect(field("Wersja minimalna").value).toBe("0.3.0");
    expect(field("Wersja zalecana").value).toBe("0.4.0");
  });

  it("cannot be saved while either version is blank", async () => {
    await renderLoaded();

    await userEvent.clear(field("Wersja minimalna"));
    expect(saveButton().disabled).toBe(true);

    await userEvent.type(field("Wersja minimalna"), "   ");
    expect(saveButton().disabled).toBe(true);

    await replaceText("Wersja minimalna", "0.3.1");
    await userEvent.clear(field("Wersja zalecana"));
    expect(saveButton().disabled).toBe(true);
  });

  it("saves both versions and shows what the server stored", async () => {
    await renderLoaded();
    const reply = deferred<OpsDesktopRelease>();
    updateMock.mockReturnValue(reply.promise);
    await replaceText("Wersja minimalna", "0.3.5");
    await replaceText("Wersja zalecana", "0.4.2");

    await userEvent.click(saveButton());

    expect(updateMock).toHaveBeenCalledExactlyOnceWith({ minimumVersion: "0.3.5", recommendedVersion: "0.4.2" });
    expect(saveButton("Zapisywanie…").disabled).toBe(true);

    reply.resolve(release({ minimumVersion: "0.3.5", recommendedVersion: "0.4.2", androidPublished: null }));

    expect(await screen.findByText("Wersje zapisane")).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText("Opublikowano 1 z 2")).toBeTruthy();
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("shows the version the server normalised", async () => {
    await renderLoaded();
    updateMock.mockResolvedValue(release({ minimumVersion: "0.3.5", recommendedVersion: "0.4.0" }));
    await replaceText("Wersja minimalna", "0.3.05");

    await userEvent.click(saveButton());

    await screen.findByText("Wersje zapisane");
    expect(field("Wersja minimalna").value).toBe("0.3.5");
  });

  it("shows the server's messages under the versions they concern", async () => {
    await renderLoaded();
    updateMock.mockRejectedValue(
      new OpsApiError(400, "Wersje są niepoprawne.", {
        minimumVersion: ["Wersja minimalna musi mieć postać 1.2.3."],
        recommendedVersion: ["Wersja zalecana jest niższa od minimalnej."],
      }),
    );

    await userEvent.click(saveButton());

    expect(await screen.findByText("Nie zapisano wersji")).toBeTruthy();
    expect(screen.getByText("Wersje są niepoprawne.")).toBeTruthy();
    expect(field("Wersja minimalna").getAttribute("aria-invalid")).toBe("true");
    expect(field("Wersja minimalna").parentElement?.textContent).toContain(
      "Wersja minimalna musi mieć postać 1.2.3.",
    );
    expect(field("Wersja zalecana").getAttribute("aria-invalid")).toBe("true");
    expect(field("Wersja zalecana").parentElement?.textContent).toContain(
      "Wersja zalecana jest niższa od minimalnej.",
    );
    expect(screen.queryByText("Wersje zapisane")).toBeNull();
  });

  it("clears the earlier refusal and success when the next save starts", async () => {
    await renderLoaded();
    updateMock.mockRejectedValueOnce(
      new OpsApiError(400, "Wersje są niepoprawne.", { minimumVersion: ["Zły format."] }),
    );
    await userEvent.click(saveButton());
    await screen.findByText("Zły format.");
    const reply = deferred<OpsDesktopRelease>();
    updateMock.mockReturnValueOnce(reply.promise);

    await userEvent.click(saveButton());

    expect(screen.queryByText("Zły format.")).toBeNull();
    expect(screen.queryByText("Nie zapisano wersji")).toBeNull();
    expect(field("Wersja minimalna").getAttribute("aria-invalid")).toBe("false");

    reply.resolve(release());
    await screen.findByText("Wersje zapisane");

    updateMock.mockRejectedValueOnce(new OpsApiError(500, "Błąd serwera."));
    await userEvent.click(saveButton());

    expect(await screen.findByText("Błąd serwera.")).toBeTruthy();
    expect(screen.queryByText("Wersje zapisane")).toBeNull();
  });

  it("explains a failure that is not an answer of the server", async () => {
    await renderLoaded();
    updateMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await userEvent.click(saveButton());

    expect(await screen.findByText("Nie udało się zapisać wersji klienta desktopowego.")).toBeTruthy();
  });
});
