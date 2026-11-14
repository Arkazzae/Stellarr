import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OverviewPane, type OverviewPaneProps } from "./OverviewPane";

function props(overrides: Partial<OverviewPaneProps> = {}): OverviewPaneProps {
  return {
    supported: false,
    iconSupported: true,
    name: "Stellarr",
    mark: "ST",
    createdAt: "2026-03-06T12:00:00Z",
    memberCount: 4,
    channelCount: 3,
    description: "Prywatna przestrzeń.",
    isPublic: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onPickIcon: vi.fn().mockResolvedValue(undefined),
    onRemoveIcon: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("OverviewPane server icon", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:server-icon");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the shared server-settings section", () => {
    render(<OverviewPane {...props()} />);

    expect(screen.getByRole("region", { name: "Profil serwera" })).toHaveClass(
      "settings-section",
      "overview-section",
    );
  });

  it("uploads a supported image from the server identity control", async () => {
    const user = userEvent.setup();
    const p = props();
    const { container } = render(<OverviewPane {...p} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["png"], "orbit.png", { type: "image/png" });

    await user.upload(input, file);

    await waitFor(() => expect(p.onPickIcon).toHaveBeenCalledWith(file));
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:server-icon");
  });

  it("shows the persisted icon and lets a manager remove it", async () => {
    const user = userEvent.setup();
    const p = props({ iconUrl: "/assets/server-icon" });
    const { container } = render(<OverviewPane {...p} />);

    expect(container.querySelector(".ov-id-ico img")).toHaveAttribute(
      "src",
      "/assets/server-icon",
    );
    await user.click(screen.getByRole("button", { name: "Usuń" }));

    expect(p.onRemoveIcon).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported file before calling the backend", () => {
    const p = props();
    const { container } = render(<OverviewPane {...p} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ikona musi być plikiem JPEG, PNG, GIF lub WebP.",
    );
    expect(p.onPickIcon).not.toHaveBeenCalled();
  });

  it("keeps icon actions disabled without manage-server support", () => {
    render(<OverviewPane {...props({ iconSupported: false })} />);

    expect(
      screen.getByRole("button", { name: "Dodaj ikonę serwera" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dodaj ikonę" })).toBeDisabled();
  });

  it("waits for the persisted server profile save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <OverviewPane {...props({ supported: true, onSave })} />,
    );
    const name = container.querySelector('input[type="text"]')!;

    await user.clear(name);
    await user.type(name, "Nowa Orbita");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      name: "Nowa Orbita",
      description: "Prywatna przestrzeń.",
      isPublic: false,
    }));
    expect(screen.getByRole("region", { name: "Zmiany" })).toHaveTextContent("Zapisano");
  });
});
