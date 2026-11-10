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
  it("marks a lone participant for the full-width mobile layout", () => {
    const { container, rerender } = render(<ParticipantTiles people={[ada]} />);

    expect(container.firstElementChild).toHaveClass("tiles", "single");

    rerender(<ParticipantTiles people={[ada, ilya]} />);

    expect(container.firstElementChild).toHaveClass("tiles");
    expect(container.firstElementChild).not.toHaveClass("single");
  });

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
