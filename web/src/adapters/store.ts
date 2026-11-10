import type {
  Bootstrap,
  Channel,
  ChannelId,
  Presence,
  Section,
  Server,
  ServerPermission,
  User,
  UserId,
  VoiceOccupant,
} from "@/lib/api/types";

/** What the read-only ports show: one server, as `bootstrap` described it. */
export interface DirectorySnapshot {
  server: Server | null;
  servers: Server[];
  channels: Channel[];
  sections: Section[];
  members: User[];
  permissions: ServerPermission[];
  occupancy: Record<ChannelId, VoiceOccupant[]>;
}

const EMPTY: DirectorySnapshot = {
  server: null,
  servers: [],
  channels: [],
  sections: [],
  members: [],
  permissions: [],
  occupancy: {},
};

type Listener = () => void;

/**
 * The directory every read-only port reads from.
 *
 * `bootstrap` delivers the server, its channels, its members and the voice
 * occupancy in one payload. Adapters share this store instead of each keeping
 * a copy that drifts: the realtime client and the admin adapter write to it,
 * the ports read from it, and React subscribes to it.
 *
 * Every change publishes a new snapshot object, so `useSyncExternalStore` and
 * `React.memo` can compare by identity.
 */
export class DirectoryStore {
  #snapshot: DirectorySnapshot = EMPTY;
  readonly #listeners = new Set<Listener>();

  getSnapshot = (): DirectorySnapshot => this.#snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  hydrate(bootstrap: Bootstrap): void {
    this.#publish({
      server: bootstrap.server,
      servers: bootstrap.servers,
      channels: [...bootstrap.channels].sort(byPosition),
      sections: [...bootstrap.sections].sort(byOrder),
      members: bootstrap.members,
      permissions: bootstrap.permissions,
      occupancy: bootstrap.voice ?? {},
    });
  }

  reset(): void {
    this.#publish(EMPTY);
  }

  setPresence(userId: UserId, presence: Presence): void {
    this.#replaceMembers((member) =>
      member.id === userId ? { ...member, presence } : member,
    );
  }

  setUser(user: User): void {
    this.#replaceMembers((member) => (member.id === user.id ? user : member));
  }

  removeMember(userId: UserId): void {
    const occupancy = Object.fromEntries(
      Object.entries(this.#snapshot.occupancy).map(([channelId, occupants]) => [
        channelId,
        occupants.filter((occupant) => occupant.userId !== userId),
      ]),
    );
    this.#update({
      members: this.#snapshot.members.filter((member) => member.id !== userId),
      occupancy,
    });
  }

  setPermissions(permissions: ServerPermission[]): void {
    this.#update({ permissions: [...permissions] });
  }

  setServer(server: Server): void {
    this.#update({
      server,
      servers: this.#snapshot.servers.map((item) =>
        item.id === server.id ? server : item,
      ),
    });
  }

  setServerIcon(iconUrl: string | undefined): void {
    const current = this.#snapshot.server;
    if (current === null) return;
    const { iconUrl: _previous, ...rest } = current;
    this.#update({ server: iconUrl === undefined ? rest : { ...rest, iconUrl } });
  }

  setOccupants(channelId: ChannelId, occupants: VoiceOccupant[]): void {
    this.#update({ occupancy: { ...this.#snapshot.occupancy, [channelId]: occupants } });
  }

  addChannel(channel: Channel): void {
    this.#update({ channels: [...this.#snapshot.channels, channel].sort(byPosition) });
  }

  setChannelSettings(channelId: ChannelId, patch: Partial<Channel>): void {
    this.#update({
      channels: this.#snapshot.channels.map((channel) =>
        channel.id === channelId ? { ...channel, ...patch } : channel,
      ),
    });
  }

  /** Channels missing from `orderedIds` keep their relative order, after the rest. */
  setChannelOrder(orderedIds: ChannelId[]): void {
    this.#update({ channels: inOrder(this.#snapshot.channels, orderedIds) });
  }

  removeChannel(channelId: ChannelId): void {
    const { [channelId]: _closed, ...occupancy } = this.#snapshot.occupancy;
    this.#update({
      channels: this.#snapshot.channels.filter((channel) => channel.id !== channelId),
      occupancy,
    });
  }

  addSection(section: Section): void {
    this.#update({ sections: [...this.#snapshot.sections, section].sort(byOrder) });
  }

  setSection(section: Section): void {
    this.#update({
      sections: this.#snapshot.sections.map((item) =>
        item.id === section.id ? section : item,
      ),
    });
  }

  setSectionOrder(orderedIds: string[]): void {
    this.#update({ sections: inOrder(this.#snapshot.sections, orderedIds) });
  }

  removeSection(sectionId: string): void {
    this.#update({
      sections: this.#snapshot.sections.filter((section) => section.id !== sectionId),
      // The server refuses to delete a section that channels still use, but a
      // channel unassigned a moment earlier must not keep a dangling id.
      channels: this.#snapshot.channels.map((channel) =>
        channel.sectionId === sectionId ? withoutSection(channel) : channel,
      ),
    });
  }

  #replaceMembers(replace: (member: User) => User): void {
    this.#update({ members: this.#snapshot.members.map(replace) });
  }

  #update(patch: Partial<DirectorySnapshot>): void {
    this.#publish({ ...this.#snapshot, ...patch });
  }

  #publish(next: DirectorySnapshot): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}

function byPosition(a: Channel, b: Channel): number {
  return (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name);
}

function byOrder(a: Section, b: Section): number {
  return a.position - b.position || a.name.localeCompare(b.name);
}

function inOrder<T extends { id: string }>(items: T[], orderedIds: string[]): T[] {
  const rank = new Map(orderedIds.map((id, position) => [id, position]));
  const rankOf = ({ id }: T): number => rank.get(id) ?? orderedIds.length;
  return [...items].sort((a, b) => rankOf(a) - rankOf(b));
}

function withoutSection({ sectionId: _sectionId, ...channel }: Channel): Channel {
  return channel;
}
