import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime, type Runtime } from "@/adapters";
import type { Bootstrap, Channel, ServerPermission, User } from "@/lib/api/types";
import { BOOTSTRAP, FakeRealtimeClient, SELF, SERVER, TEXT_CHANNEL, VOICE_CHANNEL } from "@/test/fakes";
import { fullApi, type FullApi } from "@/test/runtime";

import { DirectoryProvider, useDirectoryContext, type DirectoryValue } from "./DirectoryProvider";
import { PortsProvider } from "./PortsProvider";

const ADA: User = {
  id: "u-ada",
  username: "ada",
  displayName: "Ada Lovelace",
  presence: "idle",
  avatarUrl: "/assets/ada",
};
const SECOND_VOICE: Channel = { id: "ch-kuchnia", name: "Kuchnia", kind: "voice" };

/** Renders whatever the test selects from the context as JSON. */
function Probe({ select }: { select: (directory: DirectoryValue) => unknown }) {
  return <output aria-label="result">{JSON.stringify(select(useDirectoryContext())) ?? "undefined"}</output>;
}

const runtimes: Runtime[] = [];

async function mount(
  select: (directory: DirectoryValue) => unknown,
  overrides: Partial<Bootstrap> = {},
  api: FullApi = fullApi(),
  extra?: ReactNode,
) {
  const realtime = new FakeRealtimeClient();
  const runtime = createRuntime({ api, realtime });
  runtimes.push(runtime);
  await runtime.hydrate({ ...BOOTSTRAP, members: [SELF, ADA], ...overrides });
  render(
    <PortsProvider runtime={runtime}>
      <DirectoryProvider>
        <Probe select={select} />
        {extra}
      </DirectoryProvider>
    </PortsProvider>,
  );
  return { runtime, realtime, api };
}

/** Reports each text-channel list the provider hands out, once per new list. */
function TextChannelsSpy({
  onChange,
}: {
  onChange: (textChannels: DirectoryValue["textChannels"]) => void;
}) {
  const { textChannels } = useDirectoryContext();
  useEffect(() => onChange(textChannels), [onChange, textChannels]);
  return null;
}

function result(): unknown {
  return JSON.parse(screen.getByLabelText("result").textContent ?? "null");
}

afterEach(() => {
  // Disposing empties the stores, which the mounted provider is still reading.
  act(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
  });
});

describe("DirectoryProvider channels", () => {
  it("splits channels into text and voice view models", async () => {
    await mount((directory) => ({
      text: directory.textChannels.map((channel) => [channel.id, channel.topic]),
      voice: directory.voiceChannels.map((channel) => channel.id),
      first: directory.firstTextChannelId,
    }));

    expect(result()).toEqual({
      text: [[TEXT_CHANNEL.id, TEXT_CHANNEL.topic]],
      voice: [VOICE_CHANNEL.id],
      first: TEXT_CHANNEL.id,
    });
  });

  it("has no first text channel when the server only has voice", async () => {
    await mount((directory) => directory.firstTextChannelId, { channels: [VOICE_CHANNEL] });

    expect(result()).toBeNull();
  });

  it("names a channel, and falls back to an empty name for an unknown or missing one", async () => {
    await mount((directory) => [
      directory.channelName(TEXT_CHANNEL.id),
      directory.channelName("ch-gone"),
      directory.channelName(null),
    ]);

    expect(result()).toEqual([TEXT_CHANNEL.name, "", ""]);
  });

  it("carries the section of a channel into its view model", async () => {
    await mount(
      (directory) => ({
        sections: directory.sections,
        text: directory.textChannels.map((channel) => channel.sectionId),
      }),
      {
        channels: [{ ...TEXT_CHANNEL, sectionId: "sec-1" }],
        sections: [{ id: "sec-1", name: "Praca", position: 0 }],
      },
    );

    expect(result()).toEqual({
      sections: [{ id: "sec-1", name: "Praca" }],
      text: ["sec-1"],
    });
  });
});

describe("DirectoryProvider voice occupancy", () => {
  const occupied: Partial<Bootstrap> = {
    channels: [TEXT_CHANNEL, VOICE_CHANNEL, SECOND_VOICE],
    voice: {
      [VOICE_CHANNEL.id]: [
        { userId: ADA.id, displayName: ADA.displayName, muted: true },
        { userId: "u-guest", displayName: "Guest Visitor", muted: false },
      ],
    },
  };

  it("builds occupants from the directory's faces, online and with their microphone", async () => {
    await mount((directory) => directory.occupantsOf(VOICE_CHANNEL.id), occupied);

    expect(result()).toEqual([
      {
        id: ADA.id,
        displayName: ADA.displayName,
        initials: "AL",
        presence: "online",
        muted: true,
        avatarUrl: ADA.avatarUrl,
      },
      {
        id: "u-guest",
        displayName: "Guest Visitor",
        initials: "GV",
        presence: "online",
        muted: false,
      },
    ]);
  });

  it("answers an empty list for a channel nobody is in, without looping", async () => {
    await mount(
      (directory) => [
        directory.occupantsOf(SECOND_VOICE.id),
        directory.occupantsOf("ch-unknown"),
      ],
      occupied,
    );

    expect(result()).toEqual([[], []]);
  });

  it("lists each person on a call once in the roster group", async () => {
    await mount((directory) => directory.inVoice.map((person) => person.id), {
      ...occupied,
      voice: {
        [VOICE_CHANNEL.id]: [{ userId: ADA.id, displayName: ADA.displayName, muted: false }],
        [SECOND_VOICE.id]: [
          { userId: ADA.id, displayName: ADA.displayName, muted: false },
          { userId: SELF.id, displayName: SELF.displayName, muted: false },
        ],
      },
    });

    expect(result()).toEqual([ADA.id, SELF.id]);
  });

  it("follows the hub as people join and leave a channel", async () => {
    const { realtime } = await mount(
      (directory) => directory.occupantsOf(VOICE_CHANNEL.id).map((person) => person.id),
      occupied,
    );

    act(() =>
      realtime.push("VoiceParticipantChanged", {
        channelId: VOICE_CHANNEL.id,
        participants: [{ userId: SELF.id, displayName: SELF.displayName, muted: false }],
      }),
    );

    await waitFor(() => expect(result()).toEqual([SELF.id]));
  });

  it("keeps the same text channels while people join, mute and change presence", async () => {
    const handedOut = vi.fn();
    const { realtime } = await mount(
      (directory) => ({
        voice: directory.occupantsOf(VOICE_CHANNEL.id).map((person) => [person.id, person.muted]),
        ada: directory.people.find((person) => person.id === ADA.id)?.presence,
      }),
      occupied,
      fullApi(),
      <TextChannelsSpy onChange={handedOut} />,
    );
    const self = { userId: SELF.id, displayName: SELF.displayName };

    act(() =>
      realtime.push("VoiceParticipantChanged", {
        channelId: VOICE_CHANNEL.id,
        participants: [{ ...self, muted: false }],
      }),
    );
    act(() =>
      realtime.push("VoiceParticipantChanged", {
        channelId: VOICE_CHANNEL.id,
        participants: [{ ...self, muted: true }],
      }),
    );
    act(() => realtime.push("PresenceChanged", { userId: ADA.id, presence: "dnd" }));

    await waitFor(() => expect(result()).toEqual({ voice: [[SELF.id, true]], ada: "dnd" }));
    expect(handedOut).toHaveBeenCalledTimes(1);
  });
});

describe("DirectoryProvider people", () => {
  it("shows every member as a person with their presence", async () => {
    await mount((directory) =>
      directory.people.map((person) => [person.id, person.initials, person.presence]),
    );

    expect(result()).toEqual([
      [SELF.id, "MA", SELF.presence],
      [ADA.id, "AL", "idle"],
    ]);
  });

  it("follows a presence change announced by the hub", async () => {
    const { realtime } = await mount((directory) =>
      directory.people.find((person) => person.id === ADA.id)?.presence,
    );

    act(() => realtime.push("PresenceChanged", { userId: ADA.id, presence: "dnd" }));

    await waitFor(() => expect(result()).toBe("dnd"));
  });
});

describe("DirectoryProvider server", () => {
  it("derives the two-letter mark from the server name", async () => {
    await mount((directory) => directory.serverMark, {
      server: { ...SERVER, name: "Nocna zmiana" },
    });

    expect(result()).toBe("NZ");
  });

  it("marks a nameless server with its default letters", async () => {
    await mount((directory) => directory.serverMark, { server: { ...SERVER, name: "  " } });

    expect(result()).toBe("ST");
  });
});

describe("DirectoryProvider permission flags", () => {
  const flags = (directory: DirectoryValue) => ({
    settings: directory.canAccessServerSettings,
    server: directory.canManageServer,
    channels: directory.canManageChannels,
    messages: directory.canManageMessages,
    moderate: directory.canModerateMembers,
    bans: directory.canManageBans,
  });
  const none = {
    settings: false,
    server: false,
    channels: false,
    messages: false,
    moderate: false,
    bans: false,
  };

  it("grants nothing without permissions", async () => {
    await mount(flags, { permissions: [] });

    expect(result()).toEqual(none);
  });

  it("does not open the settings for message and member moderation alone", async () => {
    await mount(flags, { permissions: ["manageMessages", "moderateMembers"] });

    expect(result()).toEqual({ ...none, messages: true, moderate: true });
  });

  it.each([
    ["manageServer", "server"],
    ["manageChannels", "channels"],
    ["manageBans", "bans"],
  ] as const satisfies readonly (readonly [ServerPermission, string])[])(
    "opens the settings and raises only the %s flag",
    async (permission, flag) => {
      await mount(flags, { permissions: [permission] });

      expect(result()).toEqual({ ...none, settings: true, [flag]: true });
    },
  );

  it("opens the settings for any other permission, such as managing roles", async () => {
    await mount(flags, { permissions: ["manageRoles"] });

    expect(result()).toEqual({ ...none, settings: true });
  });
});

function ReorderButton({ group }: { group: string[] }) {
  const directory = useDirectoryContext();
  return (
    <button type="button" onClick={() => void directory.reorderChannelGroup(group)}>
      Reorder
    </button>
  );
}

describe("DirectoryProvider actions", () => {
  it("persists a group reorder as one order for the whole server", async () => {
    const channel = (id: string, position: number): Channel => ({
      id,
      name: id,
      kind: "text",
      position,
    });
    const api = fullApi();
    await mount(
      (directory) => directory.channels.map((item) => item.id),
      { channels: [channel("a", 0), channel("b", 1), channel("c", 2), channel("d", 3)] },
      api,
      <ReorderButton group={["c", "a"]} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reorder" }));

    expect(api.reorderChannels).toHaveBeenCalledWith(["c", "b", "a", "d"]);
    expect(result()).toEqual(["c", "b", "a", "d"]);
  });

  it("lists the servers the account belongs to", async () => {
    await mount((directory) => directory.servers.map((server) => server.id));

    expect(result()).toEqual([SERVER.id]);
  });
});
