"use client";

import { useId } from "react";

import {
  banPerson,
  blockPerson,
  kickFromChannelPerson,
  kickPerson,
  removeFriend,
} from "@/components/confirmations";
import { Icon } from "@/components/icons/Icon";
import {
  useConfirm,
  usePrompt,
  type ConfirmRequest,
} from "@/components/primitives/ConfirmDialog";
import {
  ContextMenu,
  type MenuEntry,
  type MenuItem,
} from "@/components/primitives/ContextMenu";
import { Switch } from "@/components/primitives/Switch";
import type { ProfileRelation } from "@/components/view-models";
import { useLanguage } from "@/state/LanguageProvider";

export interface UserMenuActions {
  /** Raises the mini profile. The anchor is the row or face that was clicked. */
  onOpenProfile?: (userId: string, anchor: HTMLElement) => void;
  /** Opens a conversation with them. Absent for yourself. */
  onMessage?: (userId: string) => void;
  /**
   * Where you stand with them, which decides the one friendship item the menu
   * offers. Without it the menu is just the profile and a message.
   */
  relationOf?: (userId: string) => ProfileRelation;
  onAddFriend?: (userId: string) => void;
  onRemoveFriend?: (userId: string) => void;
  onBlock?: (userId: string) => void;
  onUnblock?: (userId: string) => void;
  /**
   * Local receiver-side level for a person in this browser's current call.
   * Undefined means there is no remote audio strip to adjust.
   */
  participantVolumeOf?: (userId: string) => number | undefined;
  onParticipantVolumeChange?: (userId: string, volume: number) => void;
  /**
   * Local receiver-side gate for the same strip: it mutes them between words,
   * so breathing or a keyboard never reaches you. Undefined hides the switch.
   */
  participantGateOf?: (userId: string) => boolean | undefined;
  onParticipantGateChange?: (userId: string, gated: boolean) => void;
  /**
   * Local receiver-side noise removal on the same strip, for a person whose own
   * settings you cannot reach. Undefined hides the switch.
   */
  participantSuppressionOf?: (userId: string) => boolean | undefined;
  onParticipantSuppressionChange?: (userId: string, suppressed: boolean) => void;
  /**
   * Moderation. Kick and ban end somebody's membership; the narrower
   * kick-from-channel only disconnects the seat they hold in a voice channel,
   * so it needs `canKickFromChannel` to say they hold one.
   */
  canKick?: boolean;
  canBan?: boolean;
  onKick?: (userId: string) => void;
  canKickFromChannel?: (userId: string) => boolean;
  onKickFromChannel?: (userId: string) => void;
  onBan?: (userId: string, reason: string) => void;
  /** Adds "Kopiuj identyfikator", as the preference in "Zaawansowane" promises. */
  developerMode?: boolean;
}

export interface UserMenuProps extends UserMenuActions {
  at: { x: number; y: number };
  userId: string;
  displayName: string;
  /** True for your own row: there is no messaging, blocking or kicking yourself. */
  self?: boolean;
  /** What the menu was raised from, for the profile card to hang off. */
  anchor: HTMLElement | null;
  onClose: () => void;
}

interface Toggle {
  value: boolean;
  onChange: (value: boolean) => void;
}

interface ParticipantAudioProps {
  displayName: string;
  volume: number;
  onVolume: (volume: number) => void;
  gate?: Toggle;
  suppression?: Toggle;
}

/**
 * The local audio strip for one person in the call. It lives above the action
 * list and stays open while it is operated, because a level is adjusted by
 * listening, not by choosing once.
 */
function ParticipantAudio({
  displayName,
  volume,
  onVolume,
  gate,
  suppression,
}: ParticipantAudioProps) {
  const { t } = useLanguage();
  const sliderId = useId();
  const name = t("voice.participantVolume", { name: displayName });

  return (
    <div className="ctx-volume" role="group" aria-label={name}>
      <div className="ctx-volume-head">
        <span>
          <Icon name="speaker" size={15} />
          {t("voice.volume")}
        </span>
        <output htmlFor={sliderId}>{volume}%</output>
      </div>
      <input
        id={sliderId}
        type="range"
        min={0}
        max={200}
        step={5}
        value={volume}
        aria-label={name}
        onChange={(event) => onVolume(Number(event.target.value))}
      />
      {gate === undefined ? null : (
        <div className="ctx-gate">
          <span className="ctx-gate-label">
            <Icon name="wave" size={15} />
            {t("voice.participantGate")}
          </span>
          <Switch
            checked={gate.value}
            onChange={gate.onChange}
            label={t("voice.participantGateFor", { name: displayName })}
          />
        </div>
      )}
      {suppression === undefined ? null : (
        <div className="ctx-gate">
          <span className="ctx-gate-label">
            {/* The engine this actually runs, so the row carries the same mark
                as its rung in the audio settings. */}
            <Icon name="noiseGtcrn" size={22} />
            {t("voice.participantSuppression")}
          </span>
          <Switch
            checked={suppression.value}
            onChange={suppression.onChange}
            label={t("voice.participantSuppressionFor", { name: displayName })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The right-click menu for a person.
 *
 * It is deliberately short: who they are and talking to them, one friendship
 * item, and block. Everything else about a person belongs on their profile
 * card, which is one item away. Moderation sits last, below its own rule,
 * because the items that end somebody's presence must not be within reach of a
 * hand aiming at "Send message". Anything destructive asks first.
 */
export function UserMenu({
  at,
  userId,
  displayName,
  self = false,
  anchor,
  onClose,
  onOpenProfile,
  onMessage,
  relationOf,
  onAddFriend,
  onRemoveFriend,
  onBlock,
  onUnblock,
  participantVolumeOf,
  onParticipantVolumeChange,
  participantGateOf,
  onParticipantGateChange,
  participantSuppressionOf,
  onParticipantSuppressionChange,
  canKick = false,
  canBan = false,
  onKick,
  canKickFromChannel,
  onKickFromChannel,
  onBan,
  developerMode = false,
}: UserMenuProps) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { t } = useLanguage();
  const relation: ProfileRelation = self ? "self" : (relationOf?.(userId) ?? "none");

  const afterConfirming = (request: ConfirmRequest, act: () => void) => () => {
    void confirm(request).then((confirmed) => {
      if (confirmed) act();
    });
  };

  const identity: MenuItem[] = [];
  if (onOpenProfile !== undefined && anchor !== null) {
    identity.push({
      id: "profile",
      label: t("common.profile"),
      icon: "medal",
      onSelect: () => onOpenProfile(userId, anchor),
    });
  }
  if (!self && onMessage !== undefined) {
    identity.push({
      id: "message",
      label: t("common.message"),
      icon: "send",
      onSelect: () => onMessage(userId),
    });
  }

  // Where you stand with somebody is known here, so the menu offers the one
  // friendship item that applies instead of listing every one and leaving the
  // reader to work out which is live. A pending invitation, either way, is not
  // something to act on from a right-click.
  let friendship: MenuItem | null = null;
  if (relation === "blocked" && onUnblock !== undefined) {
    friendship = {
      id: "unblock",
      label: t("common.unblock"),
      icon: "tick",
      onSelect: () => onUnblock(userId),
    };
  } else if (relation === "friend" && onRemoveFriend !== undefined) {
    friendship = {
      id: "unfriend",
      label: t("common.removeFriend"),
      icon: "userAdd",
      onSelect: afterConfirming(removeFriend(t, displayName), () =>
        onRemoveFriend(userId),
      ),
    };
  } else if (relation === "none" && onAddFriend !== undefined) {
    friendship = {
      id: "friend",
      label: t("common.addFriend"),
      icon: "userAdd",
      onSelect: () => onAddFriend(userId),
    };
  }

  const block: MenuItem | null =
    relation !== "self" && relation !== "blocked" && onBlock !== undefined
      ? {
          id: "block",
          label: t("common.block"),
          icon: "ban",
          danger: true,
          onSelect: afterConfirming(blockPerson(t, displayName), () => onBlock(userId)),
        }
      : null;

  const removal: MenuItem[] = [];
  let ban: MenuItem | null = null;
  if (!self) {
    if (canKick && onKickFromChannel !== undefined && canKickFromChannel?.(userId) === true) {
      removal.push({
        id: "kick-channel",
        label: t("common.kickFromChannel"),
        icon: "signout",
        danger: true,
        onSelect: afterConfirming(kickFromChannelPerson(t, displayName), () =>
          onKickFromChannel(userId),
        ),
      });
    }
    if (canKick && onKick !== undefined) {
      removal.push({
        id: "kick",
        label: t("common.kickFromServer"),
        icon: "signout",
        danger: true,
        onSelect: afterConfirming(kickPerson(t, displayName), () => onKick(userId)),
      });
    }
    if (canBan && onBan !== undefined) {
      ban = {
        id: "ban",
        label: t("common.ban"),
        icon: "ban",
        danger: true,
        // The reason arrives trimmed, and is null only when the question was
        // dismissed. An empty string is a ban with no reason given, which is a
        // different thing from not banning.
        onSelect: () => {
          void prompt(banPerson(t, displayName)).then((reason) => {
            if (reason !== null) onBan(userId, reason);
          });
        },
      };
    }
  }

  // The context menu drops rules that end up at an edge or doubled, so empty
  // groups need no special casing here.
  const entries: MenuEntry[] = [...identity];
  if (friendship !== null) entries.push("separator", friendship);
  if (block !== null) entries.push(block);
  // The rule belongs to the kick items; a ban on its own follows block directly.
  if (removal.length > 0) entries.push("separator", ...removal);
  if (ban !== null) entries.push(ban);
  if (developerMode) {
    entries.push("separator", {
      id: "copy-id",
      label: t("common.copyId"),
      icon: "clipboard",
      // Clipboard access can be refused; there is nothing useful to report.
      onSelect: () => void navigator.clipboard?.writeText(userId).catch(() => undefined),
    });
  }

  const volume = self ? undefined : participantVolumeOf?.(userId);
  const gate = self ? undefined : participantGateOf?.(userId);
  const suppression = self ? undefined : participantSuppressionOf?.(userId);
  const audio =
    volume === undefined || onParticipantVolumeChange === undefined ? undefined : (
      <ParticipantAudio
        displayName={displayName}
        volume={volume}
        onVolume={(next) => onParticipantVolumeChange(userId, next)}
        gate={
          gate === undefined || onParticipantGateChange === undefined
            ? undefined
            : { value: gate, onChange: (gated) => onParticipantGateChange(userId, gated) }
        }
        suppression={
          suppression === undefined || onParticipantSuppressionChange === undefined
            ? undefined
            : {
                value: suppression,
                onChange: (suppressed) =>
                  onParticipantSuppressionChange(userId, suppressed),
              }
        }
      />
    );

  if (entries.length === 0 && audio === undefined) return null;

  return (
    <ContextMenu
      at={at}
      entries={entries}
      label={displayName}
      controls={audio}
      onClose={onClose}
    />
  );
}
