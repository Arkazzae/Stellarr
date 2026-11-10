import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmProvider } from "@/components/primitives/ConfirmDialog";
import type { MessageGroupVM } from "@/components/room/MessageGroup";
import type { MessageTranslationOptions } from "@/components/room/attachments/TranslatedTextAttachment";
import type { TranscriptSectionVM } from "@/components/room/Transcript";
import type { PersonVM } from "@/components/view-models";
import { translateMessage } from "@/i18n";

import { DmRoom, type DmRoomProps } from "./DmRoom";

interface VirtuosoProps {
  "aria-label"?: string;
  data: Array<{ id: string }>;
  components?: { Header?: ComponentType };
  itemContent: (index: number, row: unknown) => ReactElement;
  startReached?: (index: number) => void;
}

const list = vi.hoisted(() => ({ props: null as VirtuosoProps | null }));

// Virtuoso measures a scroller jsdom does not lay out, so it renders nothing
// there. This stand-in draws the header and every row, which is what a reader
// sees once the list has measured itself.
vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  return {
    Virtuoso: React.forwardRef<unknown, VirtuosoProps>(function VirtuosoStandIn(props, ref) {
      list.props = props;
      React.useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }));
      const Header = props.components?.Header;
      return React.createElement(
        "div",
        { role: "log", "aria-label": props["aria-label"] },
        Header === undefined ? null : React.createElement(Header),
        props.data.map((row, index) =>
          React.createElement(React.Fragment, { key: row.id }, props.itemContent(index, row)),
        ),
      );
    }),
  };
});

function person(id: string, displayName: string, presence: PersonVM["presence"] = "online") {
  return { id, displayName, initials: displayName.slice(0, 2).toUpperCase(), presence };
}

const ada = person("u-ada", "Ada");
const ola = person("u-ola", "Ola");

function message(id: string, authorId: string, authorName: string, text: string): MessageGroupVM {
  return {
    id,
    authorId,
    authorName,
    timestamp: "2026-08-14T10:00:00Z",
    bodies: [{ id, parts: [{ kind: "text", nodes: [{ kind: "text", text }] }] }],
  };
}

function openRoom(overrides: Partial<DmRoomProps> = {}) {
  const props: DmRoomProps = {
    peer: ada,
    sections: [],
    railOpen: false,
    onToggleRail: vi.fn(),
    onSend: vi.fn().mockResolvedValue(undefined),
    callActive: false,
    inCall: false,
    onCall: vi.fn(),
    videoOn: false,
    onVideoCall: vi.fn(),
    callPeople: [ola, ada],
    cameraStreams: new Map(),
    localPersonId: ola.id,
    participantVolumes: new Map(),
    onParticipantVolumeChange: vi.fn(),
    chips: [],
    onAttach: vi.fn(),
    onRemoveChip: vi.fn(),
    onRetryChip: vi.fn(),
    onReorderChips: vi.fn(),
    onOpenProfile: vi.fn(),
    ...overrides,
  };
  // Message groups ask for confirmation before deleting; the app wraps them.
  const view = render(<DmRoom {...props} />, { wrapper: ConfirmProvider });
  return { props, user: userEvent.setup(), ...view };
}

beforeEach(() => {
  list.props = null;
});

describe("DmRoom header", () => {
  it("titles the room with the person and says how reachable they are", () => {
    openRoom({ peer: person("u-ada", "Ada", "dnd") });

    expect(screen.getByRole("heading", { level: 2, name: "Ada" })).toBeTruthy();
    expect(screen.getByText("Nie przeszkadzać")).toBeTruthy();
  });

  it("exposes the state of the conversation drawer from the burger", async () => {
    const { user, props } = openRoom({ railOpen: true });

    const burger = screen.getByRole("button", { name: "Pokaż rozmowy" });
    expect(burger).toHaveAttribute("aria-expanded", "true");
    await user.click(burger);
    expect(props.onToggleRail).toHaveBeenCalledOnce();
  });

  it("offers the notification button inside the conversation toolbar", () => {
    openRoom({ notificationButton: <button type="button">Powiadomienia</button> });

    const toolbar = screen.getByRole("toolbar", { name: "Rozmowa" });
    expect(toolbar).toContainElement(screen.getByRole("button", { name: "Powiadomienia" }));
  });

  it("speaks English when the translator it is given does", () => {
    const translation: MessageTranslationOptions = {
      locale: "en",
      enabled: false,
      autoTranslate: false,
      targetLanguage: "en",
      t: (key, values) => translateMessage("en", key, values),
    };
    openRoom({ translation });

    expect(screen.getByRole("button", { name: "Call Ada" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show conversations" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message @Ada" })).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
  });
});

describe("DmRoom call", () => {
  it("offers to start a call when nobody is in one", async () => {
    const { user, props } = openRoom();

    const call = screen.getByRole("button", { name: "Zadzwoń do Ada" });
    expect(call).toHaveAttribute("title", "Rozpocznij rozmowę głosową");
    expect(call).toHaveAttribute("aria-pressed", "false");
    await user.click(call);

    expect(props.onCall).toHaveBeenCalledOnce();
    expect(screen.queryByText("Ola")).toBeNull();
  });

  it("offers to join when the other person is already in the call", () => {
    openRoom({ callActive: true });

    const join = screen.getByRole("button", { name: "Dołącz do rozmowy z Ada" });
    expect(join).toHaveAttribute("title", "Dołącz do rozmowy");
    expect(join).toHaveAttribute("aria-pressed", "false");
  });

  it("shows you are connected, with no tiles while only voices are in the call", () => {
    openRoom({ callActive: true, inCall: true });

    const call = screen.getByRole("button", { name: "Rozmowa z Ada jest połączona" });
    expect(call).toHaveAttribute("title", "Jesteś w tej rozmowie");
    expect(call).toHaveAttribute("aria-pressed", "true");
    // The local person has a tile only when there is video to put in one.
    expect(screen.queryByText("Ola")).toBeNull();
  });

  it("puts everyone on a tile once your own camera is on", () => {
    openRoom({ inCall: true, videoOn: true });

    expect(screen.getByText("Ola")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wyłącz kamerę" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("puts everyone on a tile when the other person's camera arrives", () => {
    const stream = {} as MediaStream;
    openRoom({ inCall: true, cameraStreams: new Map([[ada.id, stream]]) });

    expect(screen.getByText("Ola")).toBeTruthy();
    expect(screen.getByLabelText("Kamera: Ada")).toBeTruthy();
  });

  it("keeps the tiles away from a call you have not joined", () => {
    openRoom({
      inCall: false,
      videoOn: true,
      cameraStreams: new Map([[ada.id, {} as MediaStream]]),
    });

    expect(screen.queryByText("Ola")).toBeNull();
    expect(screen.queryByLabelText("Kamera: Ada")).toBeNull();
  });

  it("turns the camera on and off from the header", async () => {
    const { user, props } = openRoom();

    const camera = screen.getByRole("button", { name: "Włącz kamerę" });
    expect(camera).toHaveAttribute("aria-pressed", "false");
    await user.click(camera);

    expect(props.onVideoCall).toHaveBeenCalledOnce();
  });
});

describe("DmRoom conversation", () => {
  it("begins the history with a line saying whose conversation it is", () => {
    openRoom();

    expect(screen.getByRole("log", { name: "Wiadomości z Ada" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Ada" })).toBeTruthy();
    expect(
      screen.getByText("To początek Twojej rozmowy z Ada. Widzicie ją tylko wy dwoje."),
    ).toBeTruthy();
  });

  it("keeps the same intro through renders that do not change who it is about", () => {
    const { rerender, props } = openRoom();
    const first = list.props?.components;

    rerender(<DmRoom {...props} callActive inCall />);

    expect(list.props?.components).toBe(first);
  });

  it("shows the messages and opens the author's card from them", async () => {
    const sections: TranscriptSectionVM[] = [
      { day: "Dzisiaj", groups: [message("m1", ada.id, "Ada", "Cześć, jesteś?")] },
    ];
    const { user, props } = openRoom({ sections });

    expect(screen.getByText("Cześć, jesteś?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Profil: Ada" }));

    expect(props.onOpenProfile).toHaveBeenCalledWith(ada.id, expect.any(HTMLElement));
  });

  it("asks for older messages when the reader reaches the top, and not while loading them", () => {
    const onLoadOlderMessages = vi.fn();
    const { rerender, props } = openRoom({ hasOlderMessages: true, onLoadOlderMessages });

    list.props?.startReached?.(0);
    expect(onLoadOlderMessages).toHaveBeenCalledOnce();

    rerender(
      <DmRoom
        {...props}
        hasOlderMessages
        loadingOlderMessages
        onLoadOlderMessages={onLoadOlderMessages}
      />,
    );
    expect(list.props?.startReached).toBeUndefined();
  });

  it("does not ask for older messages when the history has none", () => {
    openRoom({ hasOlderMessages: false, onLoadOlderMessages: vi.fn() });

    expect(list.props?.startReached).toBeUndefined();
  });
});

describe("DmRoom composer", () => {
  it("is addressed to the person", () => {
    openRoom();

    expect(screen.getByRole("textbox", { name: "Napisz do @Ada" })).toHaveAttribute(
      "placeholder",
      "Napisz do @Ada",
    );
  });

  it("sends the trimmed text on Enter", async () => {
    const { user, props } = openRoom();

    await user.type(screen.getByRole("textbox"), "  do zobaczenia  {Enter}");

    expect(props.onSend).toHaveBeenCalledExactlyOnceWith("do zobaczenia");
  });

  it("sends nothing for an empty message", async () => {
    const { user, props } = openRoom();

    await user.type(screen.getByRole("textbox"), "   {Enter}");

    expect(props.onSend).not.toHaveBeenCalled();
  });

  it("hands over the files that are attached", async () => {
    const { user, props, container } = openRoom();
    const file = new File(["x"], "plan.pdf", { type: "application/pdf" });

    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file);

    expect(props.onAttach).toHaveBeenCalledWith([file]);
  });
});
