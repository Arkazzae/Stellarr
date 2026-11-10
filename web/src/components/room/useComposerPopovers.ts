"use client";

import { useRef, useState } from "react";

import { useDismissible } from "./useDismissible";

/**
 * The three things that open over the composer: the emoji picker, the
 * formatting bar and, on a phone, the tray that holds the actions. Each one
 * closes on a press elsewhere and on Escape, returning focus to its button.
 */
export function useComposerPopovers() {
  const [emojiOpen, setEmojiOpen] = useState(false);
  // False for a touch-opened picker, so browsing does not raise the keyboard.
  const [emojiAutoFocus, setEmojiAutoFocus] = useState(true);
  const [formatOpen, setFormatOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  const emojiTrigger = useRef<HTMLButtonElement | null>(null);
  const emojiPanel = useRef<HTMLDivElement | null>(null);
  const formatTrigger = useRef<HTMLButtonElement | null>(null);
  const formatPanel = useRef<HTMLDivElement | null>(null);
  const mobileActionsTrigger = useRef<HTMLButtonElement | null>(null);
  const mobileActions = useRef<HTMLDivElement | null>(null);

  // Only the picker itself counts as inside the emoji panel, so a press on the
  // clear layer around it, which is how it is dismissed on a phone, closes it.
  useDismissible(emojiOpen, {
    isInside: (target) =>
      emojiPanel.current?.querySelector(".emo-pick")?.contains(target) === true ||
      emojiTrigger.current?.contains(target) === true,
    onDismiss: () => setEmojiOpen(false),
    returnFocusTo: emojiTrigger,
  });
  useDismissible(formatOpen, {
    isInside: (target) =>
      formatPanel.current?.contains(target) === true ||
      formatTrigger.current?.contains(target) === true,
    onDismiss: () => setFormatOpen(false),
    returnFocusTo: formatTrigger,
  });
  // On a phone the actions sit behind one disclosure button instead of five
  // 44px targets around the field. The tray is a toolbar, not a modal: a press
  // elsewhere dismisses it, and a picker opened from it owns Escape until that
  // picker closes.
  useDismissible(mobileActionsOpen, {
    isInside: (target) =>
      [mobileActions, mobileActionsTrigger, emojiPanel].some((part) =>
        part.current?.contains(target),
      ),
    onDismiss: () => setMobileActionsOpen(false),
    returnFocusTo: mobileActionsTrigger,
    claimsEscape: () =>
      !emojiOpen && !mobileActions.current?.querySelector('[role="dialog"]:not([hidden])'),
  });

  return {
    emojiOpen,
    setEmojiOpen,
    emojiAutoFocus,
    setEmojiAutoFocus,
    formatOpen,
    setFormatOpen,
    mobileActionsOpen,
    setMobileActionsOpen,
    emojiTrigger,
    emojiPanel,
    formatTrigger,
    formatPanel,
    mobileActionsTrigger,
    mobileActions,
  };
}
