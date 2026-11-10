"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Whose card is open, and the element it hangs off. */
interface OpenProfileState {
  userId: string;
  anchor: HTMLElement;
  /**
   * Keyboard and precise-pointer openings move focus into the card. A touch
   * opening leaves it on the trigger, so the message field stays quiet.
   */
  autoFocus: boolean;
}

export interface ProfileValue {
  /** The open card, or null when there is none. */
  open: OpenProfileState | null;
  /**
   * Opens the card for `userId` beside `anchor`. Activating the same control
   * again closes it, as any control that opens a panel must.
   */
  toggle: (userId: string, anchor: HTMLElement) => void;
  close: () => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

/**
 * Which person's mini profile is on screen.
 *
 * There is one card for the whole app rather than one per row: a roster row, an
 * avatar in the transcript and a friend all open the same card, no two can be
 * open at once, and the card has to escape the `overflow: hidden` of whichever
 * list raised it.
 *
 * The anchor is the element and not its rectangle, so the card can follow it
 * while the page scrolls and close itself when the element goes away, which
 * happens routinely because the transcript recycles its rows.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenProfileState | null>(null);
  // A click does not say how it was made, so the last pointer or key event
  // before it decides whether it was a touch.
  const lastInputWasTouch = useRef(false);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      lastInputWasTouch.current = event.pointerType === "touch" || event.pointerType === "pen";
    };
    const onKeyDown = () => {
      lastInputWasTouch.current = false;
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  const toggle = useCallback((userId: string, anchor: HTMLElement) => {
    setOpen((current) =>
      current?.anchor === anchor
        ? null
        : {
            userId,
            anchor,
            // A focused trigger is a keyboard user even if the last pointer
            // event was a touch.
            autoFocus: !lastInputWasTouch.current || anchor.matches(":focus-visible"),
          },
    );
  }, []);

  const close = useCallback(() => setOpen(null), []);

  const value = useMemo<ProfileValue>(() => ({ open, toggle, close }), [open, toggle, close]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfileContext(): ProfileValue {
  const value = useContext(ProfileContext);
  if (value === null) {
    throw new Error("useProfile must be used inside <ProfileProvider>");
  }
  return value;
}
