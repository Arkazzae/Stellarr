import type { ConfirmRequest, PromptRequest } from "@/components/primitives/ConfirmDialog";
import type { Translator } from "@/i18n";

/**
 * Every irreversible question the app asks, in one place.
 *
 * The same deed is often reachable from more than one door (a message from its
 * hover toolbar or its context menu, a friendship from the roster or the
 * friends list), and two wordings for one consequence teach readers to stop
 * reading them. Each request is a question followed by its consequence, and
 * the confirming button names the deed rather than agreeing with the dialog.
 */

export function deleteMessageConfirmation(t: Translator): ConfirmRequest {
  return {
    title: t("message.delete.title"),
    description: t("message.delete.description"),
    confirmLabel: t("message.action.delete"),
    danger: true,
    icon: "trash",
  };
}

/**
 * The mildest of these, and the only one undone by asking again. The
 * description says so, because a question with no consequence named reads as
 * more final than it is.
 */
export function removeFriend(t: Translator, displayName: string): ConfirmRequest {
  return {
    title: t("confirm.removeFriendTitle", { name: displayName }),
    description: t("confirm.removeFriendDescription"),
    confirmLabel: t("common.remove"),
    danger: true,
    icon: "userAdd",
  };
}

export function blockPerson(t: Translator, displayName: string): ConfirmRequest {
  return {
    title: t("confirm.blockTitle", { name: displayName }),
    description: t("confirm.blockDescription"),
    confirmLabel: t("common.block"),
    danger: true,
    icon: "ban",
  };
}

export function kickPerson(t: Translator, displayName: string): ConfirmRequest {
  return {
    title: t("confirm.kickTitle", { name: displayName }),
    // A kicked person can return through an invite, which is the whole
    // difference from a ban.
    description: t("confirm.kickDescription"),
    confirmLabel: t("common.kick"),
    danger: true,
    icon: "signout",
  };
}

export function kickFromChannelPerson(t: Translator, displayName: string): ConfirmRequest {
  return {
    title: t("confirm.kickChannelTitle", { name: displayName }),
    description: t("confirm.kickChannelDescription"),
    confirmLabel: t("voiceBar.disconnect"),
    danger: true,
    icon: "signout",
  };
}

/**
 * The one that also asks for words. The bans list shows a fallback text when
 * no reason was given, so the field is offered but never required; a required
 * box would only teach people to type a full stop into it.
 */
export function banPerson(t: Translator, displayName: string): PromptRequest {
  return {
    title: t("confirm.banTitle", { name: displayName }),
    description: t("confirm.banDescription"),
    confirmLabel: t("common.ban"),
    danger: true,
    icon: "ban",
    field: {
      label: t("confirm.reasonLabel"),
      placeholder: t("confirm.reasonPlaceholder"),
      maxLength: 200,
      optional: true,
    },
  };
}

/**
 * Deleting a channel from its context menu. Here the pointer is over a row in
 * a list of similar rows, so the question names the channel it is about; the
 * channel's own settings page asks differently, because the name is on screen
 * there.
 */
export function deleteChannel(t: Translator, name: string): ConfirmRequest {
  return {
    title: t("confirm.deleteChannelTitle", { name }),
    description: t("confirm.deleteChannelDescription"),
    confirmLabel: t("common.remove"),
    danger: true,
    icon: "trash",
  };
}
