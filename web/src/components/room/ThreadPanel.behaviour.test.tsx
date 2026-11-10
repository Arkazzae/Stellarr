import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadPanel } from "./ThreadPanel";

const transcript = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("./Transcript", () => ({
  Transcript: (props: Record<string, unknown>) => {
    transcript.props = props;
    return <div data-testid="transcript" />;
  },
}));

function panel(overrides: Partial<Parameters<typeof ThreadPanel>[0]> = {}) {
  return (
    <ThreadPanel
      open
      expanded={false}
      onExpandedChange={vi.fn()}
      onClose={vi.fn()}
      sections={[]}
      label="Wątek"
      {...overrides}
    />
  );
}

describe("ThreadPanel", () => {
  it("closes from its own button", async () => {
    const onClose = vi.fn();
    render(panel({ onClose }));

    await userEvent.setup().click(screen.getByRole("button", { name: "Zamknij wątek" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes itself out of reach while it is closed", () => {
    const { container, rerender } = render(panel({ open: false }));
    const aside = container.querySelector("aside");

    expect(aside).toHaveAttribute("inert");
    expect(aside).not.toHaveClass("open");

    rerender(panel({ open: true, expanded: true }));
    expect(aside).not.toHaveAttribute("inert");
    expect(aside).toHaveClass("open", "expanded");
  });

  it("shows the thread's transcript without repeating the root above every answer", () => {
    render(panel({ label: "Wątek Mai", hasOlder: true }));

    expect(transcript.props).toMatchObject({
      label: "Wątek Mai",
      hasOlder: true,
      hideReplyReferences: true,
    });
  });

  it("does not hand the panel's own controls down to the transcript", () => {
    render(panel());

    expect(transcript.props).not.toHaveProperty("open");
    expect(transcript.props).not.toHaveProperty("expanded");
    expect(transcript.props).not.toHaveProperty("onClose");
  });

  it("places the composer after the transcript", () => {
    render(panel({ composer: <textarea aria-label="Napisz we wątku" /> }));

    const body = screen.getByTestId("transcript");
    const composer = screen.getByRole("textbox", { name: "Napisz we wątku" });
    expect(body.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
