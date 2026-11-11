import type { DragEndEvent } from "@dnd-kit/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";
import type { PersonVM } from "@/components/view-models";

import { Rail, type RailProps } from "./Rail";

/*
 * jsdom has no layout, so a real drag has nowhere to go. The drag context is
 * replaced by one that hands over its `onDragEnd`, in render order, and the
 * tests deliver the drop the library would have reported.
 */
const contexts = vi.hoisted(
  () => [] as { onDragEnd?: (event: DragEndEvent) => void }[],
);
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: ReactNode;
      onDragEnd?: (event: DragEndEvent) => void;
    }) => {
      contexts.push({ onDragEnd });
      return <>{children}</>;
    },
  };
});

const jo: PersonVM = {
  id: "u-2",
  displayName: "Jo",
  initials: "JO",
  presence: "online",
};

function setup(overrides: Partial<RailProps> = {}) {
  const props: RailProps = {
    serverName: "Orbit",
    textChannels: [
      { id: "t-1", name: "ogólny" },
      { id: "t-2", name: "plany" },
      { id: "t-3", name: "luzem" },
    ],
    voiceChannels: [
      { id: "v-1", name: "Salon", occupants: [jo] },
      { id: "v-2", name: "Sesja", occupants: [] },
    ],
    activeChannelId: null,
    selfId: "me",
    onSelectTextChannel: vi.fn(),
    onJoinVoiceChannel: vi.fn(),
    onEditServer: vi.fn(),
    onInvite: vi.fn(),
    onReorderChannelGroup: vi.fn(),
    ...overrides,
  };
  render(
    <ConfirmProvider>
      <Rail {...props} />
    </ConfirmProvider>,
  );
  return props;
}

/** The latest render's contexts: the text group first, then the voice group. */
function drops() {
  const [text, voice] = contexts.slice(-2);
  if (text?.onDragEnd === undefined || voice?.onDragEnd === undefined) {
    throw new Error("The rail did not render both groups");
  }
  return { text: text.onDragEnd, voice: voice.onDragEnd };
}

function dropText(from: string, onto: string) {
  const { text } = drops();
  act(() => {
    text({ active: { id: from }, over: { id: onto } } as DragEndEvent);
  });
}

function dropVoice(onto: string) {
  const { voice } = drops();
  act(() => {
    voice({
      active: {
        id: "voice-member:v-1:u-2",
        data: {
          current: { type: "voice-occupant", person: jo, sourceChannelId: "v-1" },
        },
      },
      over: {
        id: `voice-channel:${onto}`,
        data: { current: { type: "voice-channel", channelId: onto } },
      },
    } as unknown as DragEndEvent);
  });
}

beforeEach(() => {
  contexts.length = 0;
});

describe("Rail text channel order", () => {
  it("reports the whole group in its new order after a drop", () => {
    const { onReorderChannelGroup } = setup();

    dropText("t-3", "t-1");

    expect(onReorderChannelGroup).toHaveBeenCalledWith(["t-3", "t-1", "t-2"]);
  });

  it("reports nothing when a channel is dropped on itself or nowhere", () => {
    const { onReorderChannelGroup } = setup();
    const { text } = drops();

    dropText("t-2", "t-2");
    act(() => text({ active: { id: "t-2" }, over: null } as DragEndEvent));

    expect(onReorderChannelGroup).not.toHaveBeenCalled();
  });

  it("says the order was not saved, then clears the notice on the next try", async () => {
    const onReorderChannelGroup = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    setup({ onReorderChannelGroup });

    dropText("t-3", "t-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się zapisać kolejności kanałów.",
    );

    dropText("t-2", "t-1");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("Rail voice moves", () => {
  it("asks for the person to be moved to the channel they were dropped on", async () => {
    const onMoveVoiceMember = vi.fn(async () => {});
    setup({ onMoveVoiceMember });

    dropVoice("v-2");

    expect(onMoveVoiceMember).toHaveBeenCalledWith("u-2", "v-1", "v-2");
    await waitFor(() =>
      expect(screen.getByText("Przeniesiono użytkownika Jo.")).toBeInTheDocument(),
    );
  });

  it("marks the person as moving until the server answers", async () => {
    let finish: () => void = () => {};
    setup({
      onMoveVoiceMember: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });

    dropVoice("v-2");

    expect(screen.getByText("Jo").closest("li")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Przenoszenie użytkownika Jo.")).toBeInTheDocument();

    await act(async () => finish());
    expect(screen.getByText("Jo").closest("li")).not.toHaveAttribute("aria-busy");
  });

  it("reports a failed move as an alert", async () => {
    setup({
      onMoveVoiceMember: vi.fn().mockRejectedValue(new Error("forbidden")),
    });

    dropVoice("v-2");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się przenieść użytkownika Jo.",
    );
  });

  it("does nothing for a drop on the channel the person is already in", () => {
    const onMoveVoiceMember = vi.fn();
    setup({ onMoveVoiceMember });

    dropVoice("v-1");

    expect(onMoveVoiceMember).not.toHaveBeenCalled();
  });
});
