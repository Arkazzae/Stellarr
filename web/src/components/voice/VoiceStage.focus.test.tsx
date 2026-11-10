import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PersonVM, ScreenShareVM } from "@/components/view-models";

import { VoiceStage, type VoiceStageProps } from "./VoiceStage";

const SHARE: ScreenShareVM = {
  ownerId: "ada",
  ownerName: "Ada",
  hasAudio: false,
  posterUrl: "/screen.jpg",
  stream: null,
  watching: true,
};

const PEOPLE: PersonVM[] = [
  { id: "ada", displayName: "Ada", initials: "AD", presence: "online" },
];

function stage(props: Partial<VoiceStageProps> = {}) {
  return (
    <VoiceStage
      people={PEOPLE}
      share={null}
      onWatchShare={vi.fn()}
      onStopWatchingShare={vi.fn()}
      {...props}
    />
  );
}

const sharedScreen = () => screen.queryByRole("img", { name: "Udostępniany ekran — Ada" });
const focusBar = () => screen.queryByRole("group", { name: "Co pokazać na scenie" });

describe("VoiceStage", () => {
  it("keeps the shared screen visible and marks the stage for cinema layout", () => {
    const { container } = render(stage({ people: [], share: SHARE, cinema: true }));

    expect(container.firstElementChild).toHaveClass("voice-stage", "streaming", "cinema");
    expect(sharedScreen()).toBeVisible();
  });

  it("offers the screen and the tiles once somebody shares, and follows the choice", async () => {
    const user = userEvent.setup();
    const { container } = render(stage({ share: SHARE }));

    expect(screen.getByRole("button", { name: "Ada — ekran" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(container.firstElementChild).toHaveClass("streaming");

    await user.click(screen.getByRole("button", { name: "Kafelki" }));
    expect(screen.getByRole("button", { name: "Kafelki" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(container.firstElementChild).not.toHaveClass("streaming");
    expect(sharedScreen()).toBeNull();
    // The tiles stay on the stage whichever surface is focused.
    expect(screen.getByText("Ada", { selector: ".t-name span" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Ada — ekran" }));
    expect(container.firstElementChild).toHaveClass("streaming");
    expect(sharedScreen()).toBeVisible();
  });

  it("has no focus bar while nobody shares", () => {
    const { container, rerender } = render(stage());

    expect(focusBar()).toBeNull();
    expect(container.firstElementChild).not.toHaveClass("streaming");
    expect(container.firstElementChild).not.toHaveClass("has-focus-bar");

    rerender(stage({ share: SHARE }));
    expect(focusBar()).not.toBeNull();
    expect(container.firstElementChild).toHaveClass("has-focus-bar");

    rerender(stage());
    expect(focusBar()).toBeNull();
    expect(container.firstElementChild).not.toHaveClass("has-focus-bar");
  });

  it("applies cinema to the focused share and not to bare tiles", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(stage({ share: SHARE, cinema: true }));
    expect(container.firstElementChild).toHaveClass("cinema");

    await user.click(screen.getByRole("button", { name: "Kafelki" }));
    expect(container.firstElementChild).not.toHaveClass("cinema");

    rerender(stage({ cinema: true }));
    expect(container.firstElementChild).not.toHaveClass("cinema");
  });

  it("routes the sharer's volume strip to the person sharing", () => {
    const onParticipantVolumeChange = vi.fn();
    render(
      stage({
        share: SHARE,
        participantVolumes: new Map([["ada", 125]]),
        onParticipantVolumeChange,
      }),
    );

    const slider = screen.getByRole("slider", { name: "Głośność: Ada" });
    expect(slider).toHaveValue("125");
    fireEvent.change(slider, { target: { value: "70" } });
    expect(onParticipantVolumeChange).toHaveBeenCalledWith("ada", 70);
  });
});
