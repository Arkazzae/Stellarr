import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bootstrap, Channel, User } from "@/lib/api/types";
import type { DesktopPort } from "@/ports/desktop";
import { BOOTSTRAP, fakeApi, FakeRealtimeClient, SELF, SERVER, TEXT_CHANNEL } from "@/test/fakes";
import { fullApi, type FullApi } from "@/test/runtime";

import { __resetRuntime, createRuntime, getRuntime, type Runtime } from "./index";

const PEER: User = { id: "u-ada", username: "ada", displayName: "Ada", presence: "online" };
const OTHER_SERVER = { id: "srv-other", name: "Other" };

function bootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    ...BOOTSTRAP,
    members: [SELF, PEER],
    permissions: ["manageChannels"],
    ...overrides,
  };
}

const runtimes: Runtime[] = [];

async function hydrated(
  overrides: Partial<Bootstrap> = {},
  client: FullApi = fullApi(),
): Promise<{ runtime: Runtime; realtime: FakeRealtimeClient; client: FullApi }> {
  const realtime = new FakeRealtimeClient();
  const runtime = createRuntime({ api: client, realtime });
  runtimes.push(runtime);
  await runtime.hydrate(bootstrap(overrides));
  return { runtime, realtime, client };
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  __resetRuntime();
});

describe("runtime hydration", () => {
  it("seeds the directory, the account and the read watermarks from the boot payload", async () => {
    const { runtime } = await hydrated({
      channelReads: { [TEXT_CHANNEL.id]: "2026-01-01T19:01:00.000Z" },
    });
    const { directory, presence, account, chat } = runtime.ports;

    expect(directory.getServer()).toEqual(SERVER);
    expect(directory.listChannels().map((channel) => channel.id)).toEqual(
      BOOTSTRAP.channels.map((channel) => channel.id),
    );
    expect(directory.listPermissions()).toEqual(["manageChannels"]);
    expect(presence.listMembers().map((member) => member.id)).toEqual([SELF.id, PEER.id]);
    expect(account.getAccount().id).toBe(SELF.id);
    expect(chat.getReadState()).toEqual({ [TEXT_CHANNEL.id]: "2026-01-01T19:01:00.000Z" });
  });

  it("hands the RTC contract to the realtime client", async () => {
    const configureRtc = vi.fn();
    const realtime = Object.assign(new FakeRealtimeClient(), { configureRtc });
    const runtime = createRuntime({ api: fullApi(), realtime });
    runtimes.push(runtime);
    const rtc = {
      protocolVersion: 1,
      topology: "mesh",
      signalingHub: "/hubs/voice",
    } as unknown as NonNullable<Bootstrap["rtc"]>;

    await runtime.hydrate(bootstrap({ rtc }));

    expect(configureRtc).toHaveBeenCalledWith(rtc);
  });

  it("does not resolve until the account and the social state have loaded", async () => {
    const client = fullApi();
    await hydrated({}, client);

    expect(client.getAccount).toHaveBeenCalledOnce();
    expect(client.getSocialState).toHaveBeenCalledOnce();
    expect(client.getSoundboard).toHaveBeenCalledOnce();
  });

  it("rejects a boot whose account belongs to someone else", async () => {
    const client = fullApi();
    vi.mocked(client.getAccount).mockResolvedValueOnce({
      ...(await fakeApi().getAccount()),
      id: "u-someone-else",
    });
    const runtime = createRuntime({ api: client, realtime: new FakeRealtimeClient() });
    runtimes.push(runtime);

    await expect(runtime.hydrate(bootstrap())).rejects.toThrow();
  });
});

describe("runtime realtime wiring", () => {
  it("applies a user update to the member list", async () => {
    const { runtime, realtime } = await hydrated();

    realtime.push("UserUpdated", { ...PEER, displayName: "Ada L." });

    expect(runtime.ports.presence.listMembers().find((m) => m.id === PEER.id)?.displayName)
      .toBe("Ada L.");
  });

  it("applies a server update to the active server and the server list", async () => {
    const { runtime, realtime } = await hydrated();

    realtime.push("ServerUpdated", { ...SERVER, name: "Orbit II" });

    expect(runtime.ports.directory.getServer().name).toBe("Orbit II");
    expect(runtime.ports.directory.listServers()[0]?.name).toBe("Orbit II");
  });

  it("applies permissions only for the server that is open", async () => {
    const { runtime, realtime } = await hydrated();

    realtime.push("PermissionsChanged", {
      serverId: OTHER_SERVER.id,
      permissions: ["manageServer"],
    });
    expect(runtime.ports.directory.listPermissions()).toEqual(["manageChannels"]);

    realtime.push("PermissionsChanged", {
      serverId: SERVER.id,
      permissions: ["manageServer"],
    });
    expect(runtime.ports.directory.listPermissions()).toEqual(["manageServer"]);
  });

  it("removes a departed member only from the server that is open", async () => {
    const { runtime, realtime } = await hydrated();

    realtime.push("ServerMemberRemoved", { serverId: OTHER_SERVER.id, userId: PEER.id });
    expect(runtime.ports.presence.listMembers()).toHaveLength(2);

    realtime.push("ServerMemberRemoved", { serverId: SERVER.id, userId: PEER.id });
    expect(runtime.ports.presence.listMembers().map((member) => member.id)).toEqual([SELF.id]);
  });

  it("mirrors an edit of your own profile onto your directory row", async () => {
    const { runtime } = await hydrated();

    await runtime.ports.account.update({ displayName: "Maja K.", bio: "Hello" });

    const row = runtime.ports.presence.listMembers().find((member) => member.id === SELF.id);
    expect(row).toMatchObject({ displayName: "Maja K.", bio: "Hello" });
  });

  it("drops a picture from your row when the account no longer has one", async () => {
    const { runtime } = await hydrated({
      members: [{ ...SELF, avatarUrl: "/assets/old" }, PEER],
    });

    await runtime.ports.account.update({ avatarUrl: null });

    const row = runtime.ports.presence.listMembers().find((member) => member.id === SELF.id);
    expect(row).not.toHaveProperty("avatarUrl");
  });
});

describe("runtime disposal", () => {
  it("empties the directory and stops the socket", async () => {
    const { runtime, realtime } = await hydrated({
      channelReads: { [TEXT_CHANNEL.id]: "2026-01-01T19:01:00.000Z" },
    });
    await realtime.start();

    runtime.dispose();

    expect(runtime.ports.presence.listMembers()).toEqual([]);
    expect(runtime.ports.chat.getReadState()).toEqual({});
    expect(realtime.getStatus()).toBe("idle");
  });

  it("stops listening to the hub", async () => {
    const { runtime, realtime } = await hydrated();
    runtime.dispose();
    await runtime.hydrate(bootstrap());

    realtime.push("UserUpdated", { ...PEER, displayName: "After dispose" });

    expect(runtime.ports.presence.listMembers().find((m) => m.id === PEER.id)?.displayName)
      .toBe("Ada");
  });
});

describe("runtime options", () => {
  it("exposes the desktop port only when the shell supplies one", () => {
    const desktop = {} as DesktopPort;
    const realtime = new FakeRealtimeClient();

    const native = createRuntime({ api: fullApi(), realtime, desktop });
    const browser = createRuntime({ api: fullApi(), realtime: new FakeRealtimeClient() });
    runtimes.push(native, browser);

    expect(native.ports.desktop).toBe(desktop);
    expect("desktop" in browser.ports).toBe(false);
  });

  it("reorders channels through the api after updating the directory", async () => {
    const second: Channel = { id: "ch-second", name: "second", kind: "text", position: 5 };
    const client = fullApi();
    const { runtime } = await hydrated({ channels: [TEXT_CHANNEL, second] }, client);

    await runtime.ports.directory.reorderChannels([second.id, TEXT_CHANNEL.id]);

    expect(client.reorderChannels).toHaveBeenCalledWith([second.id, TEXT_CHANNEL.id]);
    expect(runtime.ports.directory.listChannels().map((channel) => channel.id)).toEqual([
      second.id,
      TEXT_CHANNEL.id,
    ]);
  });
});

describe("voice", () => {
  it("creates an idle voice client for the signed-in person", async () => {
    const { runtime } = await hydrated();

    const voice = runtime.ports.createVoice({ userId: SELF.id, displayName: SELF.displayName });

    expect(voice.getSnapshot().channelId).toBeNull();
    voice.dispose();
  });
});

describe("getRuntime", () => {
  it("builds one runtime and keeps it until the cache is reset", () => {
    const first = getRuntime();
    runtimes.push(first);

    expect(getRuntime()).toBe(first);

    __resetRuntime();
    const second = getRuntime();
    runtimes.push(second);
    expect(second).not.toBe(first);
  });
});
