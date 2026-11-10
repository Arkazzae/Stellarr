import type { OpenProfile, PersonVM } from "@/components/view-models";

import { ParticipantTile } from "./ParticipantTile";

export interface ParticipantTilesProps {
  /** Only the people on this channel. */
  people: PersonVM[];
  /** Camera streams by person id. A missing entry means the avatar fallback. */
  cameraStreams?: ReadonlyMap<string, MediaStream>;
  /** Whose preview must be muted to avoid feedback. */
  localPersonId?: string;
  participantVolumes?: ReadonlyMap<string, number>;
  onParticipantVolumeChange?: (personId: string, volume: number) => void;
  participantGates?: ReadonlyMap<string, boolean>;
  onParticipantGateChange?: (personId: string, gated: boolean) => void;
  participantSuppressions?: ReadonlyMap<string, boolean>;
  onParticipantSuppressionChange?: (personId: string, suppressed: boolean) => void;
  onOpenProfile?: OpenProfile;
}

/**
 * The grid of tiles. Whether it shows as a grid, a strip or not at all is
 * decided by the state classes on the stage around it.
 */
export function ParticipantTiles({
  people,
  cameraStreams,
  localPersonId,
  participantVolumes,
  onParticipantVolumeChange,
  participantGates,
  onParticipantGateChange,
  participantSuppressions,
  onParticipantSuppressionChange,
  onOpenProfile,
}: ParticipantTilesProps) {
  return (
    <div className={people.length === 1 ? "tiles single" : "tiles"}>
      {people.map((person) => (
        <ParticipantTile
          key={person.id}
          person={person}
          stream={cameraStreams?.get(person.id) ?? null}
          local={person.id === localPersonId}
          volume={participantVolumes?.get(person.id)}
          onVolumeChange={
            onParticipantVolumeChange &&
            ((volume) => onParticipantVolumeChange(person.id, volume))
          }
          gated={participantGates?.get(person.id)}
          onGateChange={
            onParticipantGateChange &&
            ((gated) => onParticipantGateChange(person.id, gated))
          }
          suppressed={participantSuppressions?.get(person.id)}
          onSuppressionChange={
            onParticipantSuppressionChange &&
            ((suppressed) => onParticipantSuppressionChange(person.id, suppressed))
          }
          onOpenProfile={onOpenProfile}
        />
      ))}
    </div>
  );
}
