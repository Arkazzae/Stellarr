import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";
import { BAR_COUNT as VOICE_BAR_COUNT } from "./VoiceRecorder";

const baseProps = {
  channelName: "general",
  onSubmit: vi.fn(),
  onRemoveChip: vi.fn(),
  onRetryChip: vi.fn(),
  onReorderChips: vi.fn(),
};

describe("Composer attachments", () => {
  it("keeps the complete attachment toolbar behind one mobile disclosure", async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...baseProps}
        chips={[]}
        onAttach={vi.fn()}
        onGif={vi.fn().mockResolvedValue(undefined)}
        openVoiceMessageMicrophone={vi.fn()}
        onSendVoice={vi.fn()}
      />,
    );

    const more = screen.getByRole("button", { name: "Więcej opcji wiadomości" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await user.click(more);

    expect(more).toHaveAttribute("aria-expanded", "true");
    const toolbar = screen.getByRole("toolbar", { name: "Więcej opcji wiadomości" });
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Wyślij jako kod" }),
    );
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Przeglądaj GIF-y" }),
    );
    expect(toolbar).toContainElement(screen.getByRole("button", { name: "Emoji" }));
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Dodaj załącznik" }),
    );
    expect(toolbar).not.toContainElement(screen.getByRole("button", { name: "Formatowanie" }));
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "Nagraj wiadomość głosową" }),
    );

    await user.keyboard("{Escape}");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
  });

  it("opens one picker for images, audio and video", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const { container } = render(
      <Composer {...baseProps} chips={[]} onAttach={onAttach} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();

    const audio = new File(["RIFF____WAVE"], "voice.wav", { type: "audio/wav" });
    await user.upload(input!, audio);

    expect(onAttach).toHaveBeenCalledWith([audio]);
  });

  it("adds files pasted with Ctrl+V to the attachment queue", () => {
    const onAttach = vi.fn();
    render(<Composer {...baseProps} chips={[]} onAttach={onAttach} />);
    const screenshot = new File(["png"], "screenshot.png", {
      type: "image/png",
    });

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: { files: [screenshot] },
    });

    expect(onAttach).toHaveBeenCalledWith([screenshot]);
  });

  it("does not send until uploads are ready", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer
        {...baseProps}
        chips={[{ id: "a", name: "clip.mp4", status: "uploading" }]}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("button", { name: /Poczekaj na przesłanie/i })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "zobacz");
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <Composer
        {...baseProps}
        chips={[{ id: "a", name: "clip.mp4", status: "ready" }]}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    expect(onSubmit).toHaveBeenCalledWith("zobacz");
  });

  it("does not erase text entered while an earlier message is being saved", async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    render(<Composer {...baseProps} chips={[]} onSubmit={onSubmit} />);
    const field = screen.getByRole("textbox");

    await user.type(field, "pierwsza");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));
    await user.type(field, " druga");
    expect(field).toHaveValue("pierwsza druga");

    await act(async () => finish?.());
    expect(field).toHaveValue("druga");
  });

  it("keeps a failed upload visible and lets the user retry it", async () => {
    const user = userEvent.setup();
    const onRetryChip = vi.fn();
    render(
      <Composer
        {...baseProps}
        chips={[
          {
            id: "a",
            name: "voice.ogg",
            status: "error",
            error: "Nie udało się przesłać załącznika.",
          },
        ]}
        onRetryChip={onRetryChip}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się przesłać");
    await user.click(screen.getByRole("button", { name: "Ponów przesyłanie voice.ogg" }));
    expect(onRetryChip).toHaveBeenCalledWith("a");
  });
});

describe("Composer formatting", () => {
  it("wraps the selection from the formatting bar and unwraps it on a second press", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps} chips={[]} />);
    const field = screen.getByRole("textbox");
    await user.type(field, "tajny plan");
    (field as HTMLTextAreaElement).setSelectionRange(0, 5);

    await user.click(screen.getByRole("button", { name: "Formatowanie" }));
    await user.click(screen.getByRole("button", { name: "Spoiler" }));
    expect(field).toHaveValue("||tajny|| plan");
    expect(screen.queryByRole("toolbar", { name: "Formatowanie" })).toBeNull();

    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    await user.click(screen.getByRole("button", { name: "Formatowanie" }));
    await user.click(screen.getByRole("button", { name: "Spoiler" }));
    expect(field).toHaveValue("tajny plan");
  });

  it("bolds with Ctrl+B and puts the caret between an empty pair", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps} chips={[]} />);
    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(field);
    await user.keyboard("{Control>}b{/Control}");
    expect(field).toHaveValue("****");
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(field.selectionStart).toBe(2);
    await user.keyboard("mocno");
    expect(field).toHaveValue("**mocno**");
  });
});

describe("Composer field sizing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("remeasures the field when returning from a thread to the channel", () => {
    let measuredHeight = 132;
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
      () => measuredHeight,
    );
    const { rerender } = render(
      <Composer {...baseProps} chips={[]} recordingScope="channel:thread:root" />,
    );

    expect(screen.getByRole("textbox")).toHaveStyle({ height: "132px" });

    measuredHeight = 36;
    rerender(<Composer {...baseProps} chips={[]} recordingScope="channel" />);

    expect(screen.getByRole("textbox")).toHaveStyle({ height: "36px" });
  });
});

describe("Composer voice messages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("records, previews and sends a standalone voice message", async () => {
    const track = { stop: vi.fn(), contentHint: "" };
    const mediaStream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    const openVoiceMessageMicrophone = vi.fn().mockResolvedValue({
      stream: mediaStream,
      inputTrack: track,
      dispose: () => track.stop(),
    });

    class RecorderMock {
      static isTypeSupported = vi.fn(() => true);
      state: RecordingState = "inactive";
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["voice-bytes"], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
      }
    }

    vi.stubGlobal("MediaRecorder", RecorderMock);
    const onSendVoice = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    const { container } = render(
      <Composer
        {...baseProps}
        chips={[]}
        openVoiceMessageMicrophone={openVoiceMessageMicrophone}
        onSendVoice={onSendVoice}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nagraj wiadomość głosową" }));
    expect(await screen.findByText("Nagrywanie")).toBeInTheDocument();
    const waveform = container.querySelector(".voice-rec-wave");
    expect(waveform).toHaveClass("wave");
    // The tape grows in from the right edge as samples arrive rather than
    // starting as a full row of flat bars, so all that can be said at the
    // moment recording begins is that it has not run past its own ceiling.
    expect(
      waveform?.querySelectorAll("i").length ?? 0,
    ).toBeLessThanOrEqual(VOICE_BAR_COUNT);
    await new Promise((resolve) => setTimeout(resolve, 550));
    await user.click(screen.getByRole("button", { name: "Zakończ nagrywanie" }));
    expect(await screen.findByText("Nagranie gotowe")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wyślij wiadomość głosową" }));

    expect(onSendVoice).toHaveBeenCalledOnce();
    const [file, duration] = onSendVoice.mock.calls[0] as [File, number];
    expect(file.type).toContain("audio/webm");
    expect(file.name).toMatch(/^wiadomosc-glosowa-.+\.webm$/);
    expect(duration).toBeGreaterThanOrEqual(0.5);
    expect(track.stop).toHaveBeenCalled();
  });

  it("fails cleanly when the recording microphone disappears", async () => {
    const track = {
      stop: vi.fn(),
      contentHint: "",
      onended: null as (() => void) | null,
    };
    const mediaStream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    const dispose = vi.fn(() => track.stop());
    const openVoiceMessageMicrophone = vi.fn().mockResolvedValue({
      stream: mediaStream,
      inputTrack: track,
      dispose,
    });

    class RecorderMock {
      static isTypeSupported = vi.fn(() => true);
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }

    vi.stubGlobal("MediaRecorder", RecorderMock);
    const user = userEvent.setup();
    render(
      <Composer
        {...baseProps}
        chips={[]}
        openVoiceMessageMicrophone={openVoiceMessageMicrophone}
        onSendVoice={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nagraj wiadomość głosową" }));
    expect(await screen.findByText("Nagrywanie")).toBeInTheDocument();
    act(() => track.onended?.());

    expect(
      await screen.findByText("Nagrywanie zostało przerwane. Spróbuj ponownie."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeVisible();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not let a text draft turn into a mixed voice message", async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...baseProps}
        chips={[]}
        openVoiceMessageMicrophone={vi.fn()}
        onSendVoice={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox"), "zapisany szkic");
    expect(screen.getByRole("button", { name: "Nagraj wiadomość głosową" }))
      .toBeDisabled();
  });
});

describe("Composer code messages", () => {
  it("sends an explicitly selected language as a fenced code block", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...baseProps} chips={[]} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Wyślij jako kod" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Język kodu wiadomości" }),
      "python",
    );
    await user.type(screen.getByRole("textbox"), "print('hej')");
    await user.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(onSubmit).toHaveBeenCalledWith("```python\nprint('hej')\n```");
  });

  it("keeps a multiline paste as text until code mode is chosen explicitly", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps} chips={[]} />);

    await user.click(screen.getByRole("textbox"));
    await user.paste("const room = createRoom();\nroom.join();\nroom.connect();");

    expect(screen.getByRole("button", { name: "Wyślij jako kod" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("combobox", { name: "Język kodu wiadomości" }))
      .toBeNull();
  });
});

describe("Composer GIF browser", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens GIPHY results and sends the selected canonical page", async () => {
    const user = userEvent.setup();
    const onGif = vi.fn().mockResolvedValue(undefined);
    const response = {
      data: [
        {
          id: "AbCd1234",
          url: "https://giphy.com/gifs/reaction-happy-AbCd1234",
          title: "Happy reaction GIF",
          alt_text: "A person celebrates.",
          images: {
            fixed_width: {
              url: "https://media.giphy.com/fixed.gif",
              webp: "https://media.giphy.com/fixed.webp",
              width: "200",
              height: "150",
            },
            fixed_width_still: {
              url: "https://media.giphy.com/still.gif",
              width: "200",
              height: "150",
            },
            downsized: {
              url: "https://media.giphy.com/downsized.gif",
              width: "480",
              height: "360",
            },
          },
          analytics: {},
        },
      ],
      pagination: { offset: 0, count: 1, total_count: 1 },
    };
    // Stellarr's API says GIFs are on; every other request is GIPHY's.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const body = String(input) === "/api/config/giphy" ? { enabled: true, apiKey: "test-key" } : response;
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    render(
      <Composer
        {...baseProps}
        chips={[]}
        giphyApiKey="test-key"
        giphyCustomerId="user-1"
        onGif={onGif}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Przeglądaj GIF-y" }));
    await user.click(await screen.findByRole("button", { name: "Wyślij GIF: A person celebrates." }));

    expect(onGif).toHaveBeenCalledWith(
      "https://giphy.com/gifs/reaction-happy-AbCd1234",
    );
    expect(screen.queryByRole("dialog", { name: "Przeglądarka GIF-ów" })).not.toBeInTheDocument();
  });

  it("keeps the GIF control visible when the key comes from runtime config", () => {
    render(
      <Composer
        {...baseProps}
        chips={[]}
        giphyApiKey=""
        onGif={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Przeglądaj GIF-y" }),
    ).toBeInTheDocument();
  });
});

describe("Composer emoji", () => {
  it("opens the file picker from the plus in the toolbar", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn();
    const { container } = render(
      <Composer {...baseProps} chips={[]} onAttach={onAttach} />,
    );

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const click = vi.spyOn(input!, "click");

    await user.click(screen.getByRole("button", { name: "Dodaj załącznik" }));

    expect(click).toHaveBeenCalled();
    // The plus is the way in for anything, not for one kind of file.
    expect(input!.accept).toContain("image/*");
    expect(input!.accept).toContain(".docx");
  });

  it("inserts a picked emoji where the caret is, not at the end", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps} chips={[]} />);

    const field = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(field, "ala ma kota");
    // Between "ala" and " ma kota".
    field.setSelectionRange(3, 3);
    await user.click(screen.getByRole("button", { name: "Emoji" }));

    await user.type(screen.getByRole("textbox", { name: "Szukaj emoji" }), "zaba");
    await user.click(screen.getByRole("option", { name: ":zaba:" }));

    expect(field).toHaveValue("ala 🐸 ma kota");
  });

  it("keeps the software keyboard closed while a finger browses emoji", () => {
    render(<Composer {...baseProps} chips={[]} />);

    const field = screen.getByRole("textbox");
    const trigger = screen.getByRole("button", { name: "Emoji" });
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger, { detail: 1 });

    const search = screen.getByRole("textbox", { name: "Szukaj emoji" });
    expect(search).not.toHaveFocus();

    const emoji = screen.getByRole("option", { name: ":usmiech:" });
    fireEvent.pointerDown(emoji, { pointerType: "touch" });
    fireEvent.click(emoji, { detail: 1 });

    expect(field).toHaveValue("😀 ");
    expect(field).not.toHaveFocus();
  });

  it("still focuses emoji search when the picker is opened from a keyboard", async () => {
    render(<Composer {...baseProps} chips={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Emoji" }), { detail: 0 });

    await vi.waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Szukaj emoji" })).toHaveFocus();
    });
  });

  it("dismisses the mobile picker from the clear viewport layer", () => {
    render(<Composer {...baseProps} chips={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Emoji" }), { detail: 0 });

    const dialog = screen.getByRole("dialog", { name: "Szukaj emoji" });
    fireEvent.pointerDown(dialog);

    expect(screen.queryByRole("dialog", { name: "Szukaj emoji" })).toBeNull();
  });

  it("puts a server emoji in as its shortcode, since a body cannot carry a picture", async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...baseProps}
        chips={[]}
        customEmoji={[
          { id: "e-1", shortcode: "mushris", glyph: "https://cdn.example/m.png" },
        ]}
      />,
    );

    // Grabbed before the picker opens: its search box is a textbox too, and
    // the panel deliberately stays open after a pick.
    const field = screen.getByRole("textbox");
    await user.click(screen.getByRole("button", { name: "Emoji" }));
    await user.click(screen.getByRole("option", { name: ":mushris:" }));

    expect(field).toHaveValue(":mushris: ");
  });
});
