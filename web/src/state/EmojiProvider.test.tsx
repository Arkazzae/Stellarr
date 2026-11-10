import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime, type Runtime } from "@/adapters";
import type { ApiCustomEmoji } from "@/lib/api/client";
import { FakeRealtimeClient } from "@/test/fakes";
import { fullApi } from "@/test/runtime";

import { EmojiProvider, useEmoji } from "./EmojiProvider";
import { PortsProvider } from "./PortsProvider";

const PARTY: ApiCustomEmoji = { id: "e-1", shortcode: ":party:", glyph: "/assets/party" };
const CAT: ApiCustomEmoji = { id: "e-2", shortcode: "cat", glyph: "/assets/cat" };

function Probe() {
  const { emoji, byShortcode, refresh } = useEmoji();
  return (
    <div>
      <output aria-label="count">{emoji.length}</output>
      <output aria-label="party">{byShortcode.get("party") ?? "none"}</output>
      <output aria-label="cat">{byShortcode.get("cat") ?? "none"}</output>
      <button type="button" onClick={() => void refresh()}>
        Refresh
      </button>
    </div>
  );
}

const runtimes: Runtime[] = [];

function mount(listEmoji: () => Promise<ApiCustomEmoji[]>) {
  const realtime = new FakeRealtimeClient();
  const runtime = createRuntime({ api: fullApi({ listEmoji: vi.fn(listEmoji) }), realtime });
  runtimes.push(runtime);
  render(
    <PortsProvider runtime={runtime}>
      <EmojiProvider>
        <Probe />
      </EmojiProvider>
    </PortsProvider>,
  );
  return { realtime };
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
});

describe("EmojiProvider", () => {
  it("loads the server's emoji and indexes them by shortcode without colons", async () => {
    mount(async () => [PARTY, CAT]);

    await waitFor(() => expect(screen.getByLabelText("count")).toHaveTextContent("2"));

    expect(screen.getByLabelText("party")).toHaveTextContent("/assets/party");
    expect(screen.getByLabelText("cat")).toHaveTextContent("/assets/cat");
  });

  it("loads again when the hub says the emoji changed", async () => {
    const lists = [[PARTY], [PARTY, CAT]];
    const { realtime } = mount(async () => lists.shift() ?? []);
    await waitFor(() => expect(screen.getByLabelText("count")).toHaveTextContent("1"));

    act(() => realtime.push("EmojiChanged", {}));

    await waitFor(() => expect(screen.getByLabelText("count")).toHaveTextContent("2"));
  });

  it("reloads on demand after an administrative change", async () => {
    const lists = [[PARTY], [CAT]];
    mount(async () => lists.shift() ?? []);
    await waitFor(() => expect(screen.getByLabelText("party")).toHaveTextContent("/assets/party"));

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(screen.getByLabelText("cat")).toHaveTextContent("/assets/cat"));
    expect(screen.getByLabelText("party")).toHaveTextContent("none");
  });

  it("stays empty and quiet when the list cannot be read", async () => {
    const list = vi.fn(async () => {
      throw new Error("forbidden");
    });
    mount(list);

    await waitFor(() => expect(list).toHaveBeenCalled());

    expect(screen.getByLabelText("count")).toHaveTextContent("0");
  });

  it("offers an empty set outside the provider instead of failing", () => {
    render(<Probe />);

    expect(screen.getByLabelText("count")).toHaveTextContent("0");
  });
});
