import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PersonVM } from "@/components/view-models";
import { renderWithConfirm } from "@/test/confirm";

import { ParticipantTiles } from "./ParticipantTiles";

const ada: PersonVM = {
  id: "ada",
  displayName: "Ada",
  initials: "AD",
  presence: "online",
};

const ilya: PersonVM = {
  id: "ilya",
  displayName: "Ilya",
  initials: "IL",
  presence: "online",
};

describe("ParticipantTiles", () => {
  it("renders a labelled, muted local camera preview", () => {
    const stream = { id: "camera-ada" } as MediaStream;

    render(
      <ParticipantTiles
        people={[ada]}
        cameraStreams={new Map([[ada.id, stream]])}
        localPersonId={ada.id}
      />,
    );

    const video = screen.getByLabelText("Kamera: Ada") as HTMLVideoElement;
    expect(video).toHaveProperty("muted", true);
    expect(video.srcObject).toBe(stream);
  });

  it("shows the face and a short line for a camera held back, never a frozen picture", () => {
    const { container } = render(
      <ParticipantTiles people={[ada, ilya]} cameraStreams={new Map()} heldCameras={new Set([ilya.id])} />,
    );

    expect(container.querySelector("video")).toBeNull();
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("Obraz wstrzymany: za słabe łącze");
    expect(line.closest(".tile")).toHaveTextContent("Ilya");
    expect(screen.getAllByText("Obraz wstrzymany: za słabe łącze")).toHaveLength(1);
  });

  it("opens a local 0–200 percent mixer strip from a remote person's menu", () => {
    const onVolumeChange = vi.fn();
    renderWithConfirm(
      <ParticipantTiles
        people={[ada, ilya]}
        localPersonId={ada.id}
        participantVolumes={new Map([[ilya.id, 125]])}
        onParticipantVolumeChange={onVolumeChange}
      />,
    );

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText("Ilya").closest(".tile")!);

    const strip = screen.getByRole("slider", { name: "Głośność: Ilya" });
    expect(strip).toHaveValue("125");
    fireEvent.change(strip, { target: { value: "160" } });
    expect(onVolumeChange).toHaveBeenCalledWith("ilya", 160);
  });

  it("opens participant actions from a real button without requiring right-click", async () => {
    const user = userEvent.setup();
    const onVolumeChange = vi.fn();
    renderWithConfirm(
      <ParticipantTiles
        people={[ada, ilya]}
        localPersonId={ada.id}
        participantVolumes={new Map([[ilya.id, 125]])}
        onParticipantVolumeChange={onVolumeChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Więcej działań: Ilya" });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Głośność: Ilya" })).toHaveValue("125");
  });
});
