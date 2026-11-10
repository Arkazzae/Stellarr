import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";

/** A ResizeObserver whose notifications the test sends by hand. */
class ObserverStub {
  static all: ObserverStub[] = [];
  targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    ObserverStub.all.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  static resize(target: Element, width: number) {
    for (const observer of ObserverStub.all) {
      if (!observer.targets.has(target)) continue;
      const entry = { target, contentRect: { width } } as ResizeObserverEntry;
      observer.callback([entry], observer as unknown as ResizeObserver);
    }
  }
}

afterEach(() => {
  ObserverStub.all = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Composer field height", () => {
  it("still refits a draft when the box changes width after a voice message was cancelled", async () => {
    vi.stubGlobal("ResizeObserver", ObserverStub);
    const scrollHeight = vi
      .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
      .mockReturnValue(48);
    const user = userEvent.setup();
    render(
      <Composer
        channelName="general"
        chips={[]}
        onSubmit={vi.fn()}
        onRemoveChip={vi.fn()}
        onRetryChip={vi.fn()}
        onReorderChips={vi.fn()}
        openVoiceMessageMicrophone={vi.fn(() => new Promise<never>(() => {}))}
        onSendVoice={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nagraj wiadomość głosową" }));
    await user.click(screen.getByRole("button", { name: "Anuluj wiadomość głosową" }));

    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "first line\nsecond line" } });
    expect(field.style.height).toBe("48px");

    // The thread is expanded: the same text now needs a different height.
    scrollHeight.mockReturnValue(72);
    ObserverStub.resize(field.parentElement as HTMLElement, 640);

    expect(field.style.height).toBe("72px");
  });
});
