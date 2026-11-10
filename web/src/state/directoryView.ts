import type {
  PersonVM,
  SectionVM,
  TextChannelVM,
  VoiceChannelVM,
} from "@/components/view-models";
import { initials } from "@/lib/format";
import type {
  Channel,
  Section,
  Server,
  ServerPermission,
  User,
  VoiceOccupant,
} from "@/ports";

/** What the directory ports hold at one moment, read in one go. */
export interface DirectorySnapshot {
  server: Server;
  servers: Server[];
  channels: Channel[];
  sections: Section[];
  members: User[];
  permissions: ServerPermission[];
  occupancy: ReadonlyMap<string, VoiceOccupant[]>;
}

/** The directory as the shell shows it: view models and permission flags. */
export interface DirectoryView {
  server: Server;
  servers: Server[];
  /** Two-letter mark for the settings brand and the invite card. */
  serverMark: string;
  channels: Channel[];
  textChannels: TextChannelVM[];
  voiceChannels: VoiceChannelVM[];
  /** Collapsible rail groups, in display order. */
  sections: SectionVM[];
  members: User[];
  permissions: ServerPermission[];
  /** Every member as a person, presence included, in bootstrap order. */
  people: PersonVM[];
  /** Who the rail shows under one voice channel. */
  occupantsOf: (channelId: string) => PersonVM[];
  /** Everyone on any voice channel, each person once. */
  inVoice: PersonVM[];
  /** At least one permission that a server-settings pane represents. */
  canAccessServerSettings: boolean;
  canManageServer: boolean;
  canManageChannels: boolean;
  canManageMessages: boolean;
  canModerateMembers: boolean;
  canManageBans: boolean;
  /** The channel the room falls back to before anything is picked. */
  firstTextChannelId: string | null;
  channelName: (channelId: string | null) => string;
}

const NO_OCCUPANTS: VoiceOccupant[] = [];

/**
 * Whether two occupancy maps say the same thing.
 *
 * `PresencePort.occupantsOf` returns a fresh `[]` for an empty channel, so an
 * identity compare would report a change on every read and
 * `useSyncExternalStore` would loop. Two empty lists are the same answer.
 */
export function sameOccupancy(
  a: ReadonlyMap<string, VoiceOccupant[]>,
  b: ReadonlyMap<string, VoiceOccupant[]>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [channelId, list] of a) {
    const other = b.get(channelId);
    if (other === undefined) return false;
    if (other !== list && (list.length > 0 || other.length > 0)) return false;
  }
  return true;
}

/** "Orbit" gives "OR" and "Nocna zmiana" gives "NZ"; an empty name gives "ST". */
export function serverMark(name: string): string {
  return name.trim() === "" ? "ST" : initials(name);
}

function toPerson(user: User): PersonVM {
  return {
    id: user.id,
    displayName: user.displayName,
    initials: initials(user.displayName),
    presence: user.presence,
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

/**
 * A `VoiceOccupant` carries what signalling knows about someone on a channel:
 * an id, a name and a microphone. Their face has to come from the directory,
 * and a peer it has never heard of still renders, on initials, mid-join.
 */
function occupantToPerson(
  occupant: VoiceOccupant,
  members: ReadonlyMap<string, User>,
): PersonVM {
  const avatarUrl = members.get(occupant.userId)?.avatarUrl;
  return {
    id: occupant.userId,
    displayName: occupant.displayName,
    initials: initials(occupant.displayName),
    // Someone in a call is reachable by definition, and the row shows their
    // microphone in place of their presence anyway.
    presence: "online",
    muted: occupant.muted,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}

export function deriveDirectoryView(snapshot: DirectorySnapshot): DirectoryView {
  const { server, channels, members, permissions, occupancy } = snapshot;
  const membersById = new Map(members.map((member) => [member.id, member]));
  const peopleOn = (channelId: string): PersonVM[] =>
    (occupancy.get(channelId) ?? NO_OCCUPANTS).map((occupant) =>
      occupantToPerson(occupant, membersById),
    );

  const textChannels: TextChannelVM[] = channels
    .filter((channel) => channel.kind === "text")
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      ...(channel.topic === undefined ? {} : { topic: channel.topic }),
      ...(channel.sectionId === undefined ? {} : { sectionId: channel.sectionId }),
    }));

  const voiceChannels: VoiceChannelVM[] = channels
    .filter((channel) => channel.kind === "voice")
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      occupants: peopleOn(channel.id),
      ...(channel.sectionId === undefined ? {} : { sectionId: channel.sectionId }),
    }));

  const inVoice = new Map<string, PersonVM>();
  for (const channel of voiceChannels) {
    for (const person of channel.occupants) {
      if (!inVoice.has(person.id)) inVoice.set(person.id, person);
    }
  }

  return {
    server,
    servers: snapshot.servers,
    serverMark: serverMark(server.name),
    channels,
    textChannels,
    voiceChannels,
    sections: snapshot.sections.map((section) => ({ id: section.id, name: section.name })),
    members,
    permissions,
    people: members.map(toPerson),
    occupantsOf: peopleOn,
    inVoice: [...inVoice.values()],
    canAccessServerSettings: permissions.some(
      (permission) => permission !== "manageMessages" && permission !== "moderateMembers",
    ),
    canManageServer: permissions.includes("manageServer"),
    canManageChannels: permissions.includes("manageChannels"),
    canManageMessages: permissions.includes("manageMessages"),
    canModerateMembers: permissions.includes("moderateMembers"),
    canManageBans: permissions.includes("manageBans"),
    firstTextChannelId: textChannels[0]?.id ?? null,
    channelName: (channelId) =>
      channels.find((channel) => channel.id === channelId)?.name ?? "",
  };
}

/**
 * Splices one group's new order back into the server-wide order.
 *
 * The channel endpoint takes a single order for the whole server, while a drag
 * reorders one rail group. The existing order is walked in place, and wherever
 * a slot belongs to the dragged group it takes the next id from the new
 * sequence. Every channel outside the group keeps the position it had.
 */
export function spliceGroupOrder(
  channels: readonly Channel[],
  newGroupOrder: readonly string[],
): string[] {
  const group = new Set(newGroupOrder);
  let cursor = 0;
  return channels.map((channel) =>
    group.has(channel.id) ? (newGroupOrder[cursor++] ?? channel.id) : channel.id,
  );
}
