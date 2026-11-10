import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime, type Runtime } from "@/adapters";
import type { JoinSoundLibrary, SoundboardSound } from "@/lib/api/types";
import { AccountProvider } from "@/state/AccountProvider";
import { PortsProvider } from "@/state/PortsProvider";
import { BOOTSTRAP, FakeRealtimeClient, SELF } from "@/test/fakes";
import { fullApi, type FullApi } from "@/test/runtime";

import { useJoinSound } from "./useJoinSound";

function sound(id: string): SoundboardSound {
  return {
    id,
    name: `Sound ${id}`,
    glyph: "🔔",
    url: `/sounds/${id}.mp3`,
    durationSeconds: 2,
    trimStartSeconds: 0,
    trimEndSeconds: 2,
  };
}

const LIBRARY: JoinSoundLibrary = {
  maxSeconds: 3,
  selectedId: null,
  servers: [
    { serverId: "srv-1", serverName: "Orbit", sounds: [sound("a"), sound("b")] },
    { serverId: "srv-2", serverName: "Nebula", sounds: [sound("c")] },
  ],
};

/**
 * The API as the server answers it: a cleared arrival sound is sent as an
 * empty id and comes back as `null`, which the fake alone does not do.
 */
function serverApi(overrides: Partial<FullApi> = {}): FullApi {
  const base = fullApi({ getJoinSoundLibrary: vi.fn(async () => LIBRARY) });
  return {
    ...base,
    updatePreferences: vi.fn(async (input) => {
      const saved = await base.updatePreferences(input);
      return { ...saved, joinSoundId: saved.joinSoundId || null };
    }),
    ...overrides,
  };
}

const runtimes: Runtime[] = [];

async function mount(open: boolean, api: FullApi = serverApi()) {
  const runtime = createRuntime({ api, realtime: new FakeRealtimeClient() });
  runtimes.push(runtime);
  await runtime.hydrate({ ...BOOTSTRAP, members: [SELF] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PortsProvider runtime={runtime}>
      <AccountProvider>{children}</AccountProvider>
    </PortsProvider>
  );
  const view = renderHook(({ shown }) => useJoinSound(shown), {
    initialProps: { shown: open },
    wrapper,
  });
  return { runtime, api, ...view };
}

afterEach(() => {
  act(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
});

describe("useJoinSound", () => {
  it("does not read the catalogue while the dialog is closed", async () => {
    const api = serverApi();
    const { result } = await mount(false, api);

    expect(api.getJoinSoundLibrary).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it("loads the catalogue when the dialog opens", async () => {
    const api = serverApi();
    const { result, rerender } = await mount(false, api);

    rerender({ shown: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.servers.map((group) => group.serverName)).toEqual([
      "Orbit",
      "Nebula",
    ]);
    expect(result.current.maxSeconds).toBe(3);
    expect(result.current.failed).toBe(false);
  });

  it("keeps the shared ceiling when the catalogue does not state one", async () => {
    const api = serverApi({
      getJoinSoundLibrary: vi.fn(async () => ({ ...LIBRARY, maxSeconds: 0 })),
    });
    const { result } = await mount(true, api);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.maxSeconds).toBe(5);
  });

  it("reports a failed read and recovers on reload", async () => {
    const read = vi
      .fn<FullApi["getJoinSoundLibrary"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(LIBRARY);
    const { result } = await mount(true, serverApi({ getJoinSoundLibrary: read }));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.loading).toBe(false);

    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(false);
    expect(result.current.servers).toHaveLength(2);
  });

  it("abandons the read when the dialog closes before it answers", async () => {
    let signal: AbortSignal | undefined;
    const api = serverApi({
      getJoinSoundLibrary: vi.fn((given?: AbortSignal) => {
        signal = given;
        return new Promise<JoinSoundLibrary>(() => undefined);
      }),
    });
    const { rerender } = await mount(true, api);
    await waitFor(() => expect(signal).toBeDefined());

    rerender({ shown: false });

    expect(signal?.aborted).toBe(true);
  });

  it("saves the chosen sound on the account", async () => {
    const api = serverApi();
    const { result } = await mount(true, api);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.select("b"));

    await waitFor(() => expect(result.current.selectedId).toBe("b"));
    expect(api.updatePreferences).toHaveBeenCalledWith({ joinSoundId: "b" });
    expect(result.current.selectionAvailable).toBe(true);
  });

  it("clears the choice back to the shared chime", async () => {
    const api = serverApi();
    const { result } = await mount(true, api);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.select("a"));
    await waitFor(() => expect(result.current.selectedId).toBe("a"));

    act(() => result.current.select(null));

    await waitFor(() => expect(result.current.selectedId).toBeNull());
    expect(api.updatePreferences).toHaveBeenLastCalledWith({ joinSoundId: "" });
  });

  it("swallows a rejected save and keeps the earlier choice", async () => {
    const api = serverApi({
      updatePreferences: vi.fn(async () => {
        throw new Error("rejected");
      }),
    });
    const { result } = await mount(true, api);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.select("a"));

    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalled());
    expect(result.current.selectedId).toBeNull();
  });

  it("flags a stored choice that is no longer in the catalogue", async () => {
    const { result, runtime } = await mount(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => runtime.ports.account.setPreferences({ joinSoundId: "left-server" }));

    expect(result.current.selectedId).toBe("left-server");
    expect(result.current.selectionAvailable).toBe(false);
  });

  it("previews the selected sound through the soundboard port", async () => {
    const { result, runtime } = await mount(true);
    const preview = vi
      .spyOn(runtime.ports.soundboard, "preview")
      .mockResolvedValue(undefined);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.preview());
    expect(preview).not.toHaveBeenCalled();

    act(() => result.current.select("c"));
    await waitFor(() => expect(result.current.selectedId).toBe("c"));
    act(() => result.current.preview());

    expect(preview).toHaveBeenCalledWith(LIBRARY.servers[1]?.sounds[0]);
  });
});
