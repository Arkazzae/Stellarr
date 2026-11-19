import type { OpenProfile, PersonVM } from "@/components/view-models";
import type { SoundboardLive } from "@/ports";

import { ParticipantTile, type ParticipantTileProps } from "./ParticipantTile";
import { useTileGrid } from "./useTileGrid";

export interface ParticipantTilesProps {
  /** Only the people on this channel. */
  people: PersonVM[];
  /** Camera streams by person id. A missing entry means the avatar fallback. */
  cameraStreams?: ReadonlyMap<string, MediaStream>;
  /** People whose camera is held back for the viewer's link; their tiles say so. */
  heldCameras?: ReadonlySet<string>;
  /** Whose preview must be muted to avoid feedback. */
  localPersonId?: string;
  participantVolumes?: ReadonlyMap<string, number>;
  onParticipantVolumeChange?: (personId: string, volume: number) => void;
  participantGates?: ReadonlyMap<string, boolean>;
  onParticipantGateChange?: (personId: string, gated: boolean) => void;
  participantSuppressions?: ReadonlyMap<string, boolean>;
  onParticipantSuppressionChange?: (personId: string, suppressed: boolean) => void;
  /** The board's clips under way, so whoever played one wears its emoji while it plays. */
  soundPlays?: SoundboardLive;
  onOpenProfile?: OpenProfile;
}

/** What feeds the tiles of a call, by person: everything but the people. */
export type ParticipantTileSources = Omit<ParticipantTilesProps, "people">;

/**
 * One person's tile, fed from the call's maps: their camera or the note that
 * it is held back, their mixer strip and their menu. Every layout of a call
 * takes its tiles from here, so none of them wires a person differently.
 */
export function participantTileProps(
  person: PersonVM,
  {
    cameraStreams,
    heldCameras,
    localPersonId,
    participantVolumes,
    onParticipantVolumeChange,
    participantGates,
    onParticipantGateChange,
    participantSuppressions,
    onParticipantSuppressionChange,
    soundPlays,
    onOpenProfile,
  }: ParticipantTileSources,
): ParticipantTileProps {
  return {
    person,
    stream: cameraStreams?.get(person.id) ?? null,
    held: heldCameras?.has(person.id) ?? false,
    local: person.id === localPersonId,
    volume: participantVolumes?.get(person.id),
    onVolumeChange:
      onParticipantVolumeChange && ((volume) => onParticipantVolumeChange(person.id, volume)),
    gated: participantGates?.get(person.id),
    onGateChange:
      onParticipantGateChange && ((gated) => onParticipantGateChange(person.id, gated)),
    suppressed: participantSuppressions?.get(person.id),
    onSuppressionChange:
      onParticipantSuppressionChange &&
      ((suppressed) => onParticipantSuppressionChange(person.id, suppressed)),
    soundPlays,
    onOpenProfile,
  };
}

/**
 * The grid of tiles. Whether it shows as a grid, a strip or not at all is
 * decided by the state classes on the stage around it; as a grid, it is as
 * even as the room allows (`useTileGrid`).
 */
export function ParticipantTiles({ people, ...sources }: ParticipantTilesProps) {
  const grid = useTileGrid(people.length);

  return (
    <div ref={grid} className="tiles">
      {people.map((person) => (
        <ParticipantTile key={person.id} {...participantTileProps(person, sources)} />
      ))}
    </div>
  );
}
