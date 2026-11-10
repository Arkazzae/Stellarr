import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChannelButton } from "./ChannelButton";

const onSelect = vi.fn();

describe("ChannelButton badges", () => {
  it("announces unread messages and caps the visible number at 99+", () => {
    const { rerender } = render(
      <ChannelButton kind="text" name="ogólny" unread={7} onSelect={onSelect} />,
    );
    expect(screen.getByLabelText("Nieprzeczytane: 7")).toHaveTextContent("7");

    rerender(
      <ChannelButton kind="text" name="ogólny" unread={240} onSelect={onSelect} />,
    );
    expect(screen.getByLabelText("Nieprzeczytane: 240")).toHaveTextContent("99+");
  });

  it("shows no badge on a channel without unread messages", () => {
    render(<ChannelButton kind="text" name="ogólny" onSelect={onSelect} />);

    expect(screen.queryByLabelText(/Nieprzeczytane/)).toBeNull();
  });

  it("marks a muted text channel, independently of unread", () => {
    render(
      <ChannelButton kind="text" name="ogólny" muted unread={3} onSelect={onSelect} />,
    );

    expect(screen.getByLabelText("Powiadomienia wyciszone")).toBeInTheDocument();
    expect(screen.getByLabelText("Nieprzeczytane: 3")).toBeInTheDocument();
  });

  it("hides the participant count of an empty voice channel", () => {
    const { rerender } = render(
      <ChannelButton kind="voice" name="Rozmowa" count={0} onSelect={onSelect} />,
    );
    expect(screen.getByText("0")).not.toBeVisible();

    rerender(
      <ChannelButton
        kind="voice"
        name="Rozmowa"
        count={2}
        countLabel="2 osoby w rozmowie"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByLabelText("2 osoby w rozmowie")).toBeVisible();
  });

  it("offers a thread disclosure only on a text channel that has threads", () => {
    const { rerender } = render(
      <ChannelButton
        kind="text"
        name="ogólny"
        threadCount={0}
        onToggleThreads={vi.fn()}
        onSelect={onSelect}
      />,
    );
    expect(screen.queryByRole("button", { name: /wątki kanału/ })).toBeNull();

    rerender(
      <ChannelButton
        kind="text"
        name="ogólny"
        threadCount={2}
        threadsOpen
        onToggleThreads={vi.fn()}
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Ukryj wątki kanału ogólny" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
