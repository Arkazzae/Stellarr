"use client";

import { useRef, useState } from "react";

import { deleteMessageConfirmation } from "@/components/confirmations";
import { Icon, type IconName } from "@/components/icons/Icon";
import { useConfirm } from "@/components/primitives/ConfirmDialog";
import { translateMessage, type MessageKey, type Translator } from "@/i18n";
import type { CustomEmoji, MessageActionSupport } from "@/ports";

import { MessageActionSheet, type SheetItem } from "./MessageActionSheet";
import {
  placeReactionPopover,
  ReactionPopover,
  type PopoverPlacement,
} from "./ReactionPopover";

/** Where the toolbar folds into the action sheet; the same width the style sheet uses. */
const PHONE_QUERY = "(max-width: 767px)";

export type MessageAction = "reply" | "thread" | "edit" | "pin" | "delete";

interface Viewer {
  /** This message is yours. */
  own: boolean;
  /** You may moderate this channel. */
  canModerate: boolean;
}

interface ActionSpec {
  action: MessageAction;
  icon: IconName;
  label: MessageKey;
  /** The port flag that says whether the server can do it at all. */
  supports: keyof MessageActionSupport;
  /** Who is offered it. Absent means everyone; a refused action is left out, not greyed. */
  allowedFor?(viewer: Viewer): boolean;
  /** Leaves the compact desktop toolbar first; the phone sheet keeps it. */
  secondary?: boolean;
  danger?: boolean;
}

const ACTIONS: readonly ActionSpec[] = [
  { action: "reply", icon: "reply", label: "message.action.reply", supports: "replies" },
  {
    action: "thread",
    icon: "thread",
    label: "message.action.thread",
    supports: "threads",
    secondary: true,
  },
  {
    action: "edit",
    icon: "edit",
    label: "message.action.edit",
    supports: "editing",
    // Only your own. Rewriting somebody else's message leaves their name over
    // words they never wrote, which no amount of moderator is a reason for.
    allowedFor: ({ own }) => own,
  },
  {
    action: "pin",
    icon: "pin",
    label: "message.action.pin",
    supports: "pins",
    // Anyone's message, and only a moderator's. A pin puts one message above
    // the conversation for everybody who opens the channel, so it is not a
    // bookmark you keep for yourself; the server says the same.
    allowedFor: ({ canModerate }) => canModerate,
    // Deliberate and rare, so the first to fold away from a narrow toolbar.
    secondary: true,
  },
  {
    action: "delete",
    icon: "trash",
    label: "message.action.delete",
    supports: "deletion",
    allowedFor: ({ own, canModerate }) => own || canModerate,
    danger: true,
  },
];

export interface MessageToolbarProps {
  onReact?(emoji: string): void;
  onAction?(action: MessageAction): void;
  /**
   * Missing means "everything works". A false flag disables the control rather
   * than hiding it, so the surface stays honest about what the server owes us.
   */
  support?: MessageActionSupport;
  /** The server's own emoji, offered first in the picker. */
  customEmoji?: readonly CustomEmoji[];
  /** This message is yours: yours to edit, and yours to delete. */
  own?: boolean;
  /** You may moderate this channel, which is a licence to delete, not to edit. */
  canModerate?: boolean;
  /** Already pinned: the same control unpins it, and says so. */
  pinned?: boolean;
  t?: Translator;
}

interface OpenPicker {
  placement: PopoverPlacement;
  autoFocus: boolean;
}

export function MessageToolbar({
  onReact,
  onAction,
  support,
  customEmoji = [],
  own = false,
  canModerate = false,
  pinned = false,
  t = (key, values) => translateMessage("pl", key, values),
}: MessageToolbarProps) {
  const confirm = useConfirm();
  const [picker, setPicker] = useState<OpenPicker | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const sheetTrigger = useRef<HTMLButtonElement>(null);
  // Whether the last press was a finger or a pen. The picker then opens without
  // focusing its search field, which would raise the on-screen keyboard over it.
  const touched = useRef(false);

  const supported = (flag: keyof MessageActionSupport) =>
    support === undefined || support[flag];

  const viewer: Viewer = { own, canModerate };
  const actions = ACTIONS.filter((spec) => spec.allowedFor?.(viewer) ?? true);

  // One button in both directions: the label follows the message rather than a
  // second control appearing beside the first.
  const labelOf = ({ action, label }: ActionSpec) =>
    action === "pin" && pinned ? t("message.action.unpin") : t(label);

  const run = ({ action }: ActionSpec) => {
    if (onAction === undefined) return;
    if (action !== "delete") {
      onAction(action);
      return;
    }
    void confirm(deleteMessageConfirmation(t)).then((confirmed) => {
      if (confirmed) onAction(action);
    });
  };

  const openPicker = () => {
    const anchor = toolbar.current?.getBoundingClientRect();
    if (anchor === undefined) return;
    setPicker({ placement: placeReactionPopover(anchor), autoFocus: !touched.current });
  };

  const closePicker = (restoreFocus: boolean) => {
    setPicker(null);
    if (!restoreFocus) return;
    const trigger = window.matchMedia(PHONE_QUERY).matches ? sheetTrigger : pickerTrigger;
    trigger.current?.focus();
  };

  const sheetItems: SheetItem[] = [
    {
      id: "react",
      label: t("message.action.chooseReaction"),
      icon: "smiley",
      disabled: !supported("reactions"),
      onSelect: openPicker,
    },
    ...actions.map((spec) => ({
      id: spec.action,
      label: labelOf(spec),
      icon: spec.icon,
      danger: spec.danger,
      disabled: !supported(spec.supports),
      pressed: spec.action === "pin" ? pinned : undefined,
      onSelect: () => run(spec),
    })),
  ];

  return (
    <div
      ref={toolbar}
      className="msg-toolbar"
      role="toolbar"
      aria-label={t("message.actions")}
      // Captured here because the sheet is portaled, and its presses still
      // bubble through this element in the React tree.
      onPointerDownCapture={(event) => {
        touched.current = event.pointerType !== "mouse";
      }}
      onKeyDownCapture={() => {
        touched.current = false;
      }}
    >
      <button
        ref={pickerTrigger}
        type="button"
        className={picker === null ? "tb emo-more" : "tb emo-more on"}
        aria-label={t("message.action.chooseReaction")}
        aria-haspopup="dialog"
        aria-expanded={picker !== null}
        disabled={!supported("reactions")}
        onClick={() => (picker === null ? openPicker() : closePicker(false))}
      >
        <Icon name="smiley" size={15} />
      </button>
      <span className="tb-sep" aria-hidden="true" />
      {actions.map((spec) => {
        const label = labelOf(spec);
        const isPin = spec.action === "pin";
        return (
          <button
            key={spec.action}
            type="button"
            className={[
              "tb",
              spec.secondary === true && "tb-x",
              spec.danger === true && "danger",
              isPin && pinned && "on",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={label}
            title={label}
            aria-pressed={isPin ? pinned : undefined}
            disabled={!supported(spec.supports)}
            onClick={() => run(spec)}
          >
            {/* The same glyph pinned or not: `aria-pressed` and the tint say
                which, the way the composer's code toggle does. */}
            <Icon name={spec.icon} size={isPin ? 17 : 15} />
          </button>
        );
      })}
      <button
        ref={sheetTrigger}
        type="button"
        className="tb msg-mobile-more"
        aria-label={t("message.actions")}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen((open) => !open)}
      >
        <Icon name="dots" size={18} />
      </button>
      {picker === null ? null : (
        <ReactionPopover
          placement={picker.placement}
          label={t("message.action.chooseReaction")}
          autoFocus={picker.autoFocus}
          customEmoji={customEmoji}
          triggers={[pickerTrigger, sheetTrigger]}
          // A reaction is one emoji, so the panel closes behind it — unlike
          // the composer's, where three in a row is the normal case.
          onPick={(reaction) => {
            onReact?.(reaction);
            closePicker(false);
          }}
          onClose={closePicker}
        />
      )}
      {sheetOpen ? (
        <MessageActionSheet
          title={t("message.actions")}
          closeLabel={t("common.close")}
          items={sheetItems}
          returnFocusTo={sheetTrigger}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
