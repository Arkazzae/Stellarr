"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { cx } from "../cx";
import { Icon } from "../icons/Icon";
import { focusFirst, trapTab } from "../internal/focus";
import { hideOthers, lockScroll, useLayer } from "../internal/layers";
import { usePresence } from "../internal/presence";
import { useComposedRefs } from "../internal/refs";
import { Slot } from "../internal/slot";
import { useControllableState } from "../internal/state";

interface DialogContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLElement | null>;
  contentId: string;
  titleId: string;
  descriptionId: string;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (context === null) throw new Error("Dialog and Sheet parts must sit inside <Dialog> or <Sheet>.");
  return context;
}

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

/**
 * A modal window: a centred dialog for a decision that comes before anything
 * else, or a sheet along an edge for a form beside the page. While it is open
 * the page behind it is inert to the keyboard, the pointer and assistive tech,
 * and Escape, the backdrop and the close button all close it.
 */
export function Dialog({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {
  const [current, setOpen] = useControllableState({ value: open, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLElement | null>(null);
  const id = useId();

  return (
    <DialogContext.Provider
      value={{
        open: current,
        setOpen,
        triggerRef,
        contentId: `${id}-content`,
        titleId: `${id}-title`,
        descriptionId: `${id}-description`,
      }}
    >
      {children}
    </DialogContext.Provider>
  );
}

interface AsChild {
  /** Gives the one child element, usually a Button, this part's behaviour. */
  asChild?: boolean;
}

export function DialogTrigger({ asChild, onClick, ref, ...props }: ComponentProps<"button"> & AsChild) {
  const dialog = useDialog();
  const composedRef = useComposedRefs<HTMLButtonElement>(ref, dialog.triggerRef as RefObject<HTMLButtonElement | null>);
  const shared = {
    ref: composedRef,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": dialog.open,
    "aria-controls": dialog.open ? dialog.contentId : undefined,
    "data-state": dialog.open ? "open" : "closed",
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) dialog.setOpen(!dialog.open);
    },
  };
  return asChild ? <Slot {...props} {...shared} /> : <button type="button" {...props} {...shared} />;
}

export function DialogClose({ asChild, onClick, ...props }: ComponentProps<"button"> & AsChild) {
  const dialog = useDialog();
  const shared = {
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) dialog.setOpen(false);
    },
  };
  return asChild ? <Slot {...props} {...shared} /> : <button type="button" {...props} {...shared} />;
}

interface ModalContentProps extends ComponentProps<"div"> {
  /** The close button's accessible name, such as "Close". */
  closeLabel: string;
}

/** The shared body of a dialog and a sheet; `surface` is the class that draws it. */
function ModalContent({
  surface,
  side,
  closeLabel,
  className,
  children,
  ...props
}: ModalContentProps & { surface: "ui-dialog" | "ui-sheet"; side?: "left" | "right" }) {
  const dialog = useDialog();
  const { open } = dialog;
  const overlay = usePresence<HTMLDivElement>(open);
  const content = usePresence<HTMLDivElement>(open);
  const contentRef = content.ref;
  const state = open ? "open" : "closed";

  useLayer(open, {
    node: () => contentRef.current,
    onEscape: () => dialog.setOpen(false),
    onTab: (event) => {
      if (contentRef.current !== null) trapTab(event, contentRef.current);
    },
    onPointerDownOutside: () => dialog.setOpen(false),
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const keep = [contentRef.current, overlay.ref.current];
    const showOthers = hideOthers(keep);
    const unlockScroll = lockScroll(() => (contentRef.current === null ? [] : [contentRef.current]));
    focusFirst(contentRef.current);

    return () => {
      showOthers();
      unlockScroll();
      // Back to what opened it. If that has left the page, focus stays where it is.
      const back = dialog.triggerRef.current ?? opener;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
    // Runs once per opening; the refs are stable.
  }, [open]);

  if (!overlay.present && !content.present) return null;

  return createPortal(
    <>
      {overlay.present ? <div ref={overlay.ref} className="ui-overlay" data-state={state} /> : null}
      {content.present ? (
        <div
          ref={contentRef}
          id={dialog.contentId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialog.titleId}
          aria-describedby={dialog.descriptionId}
          tabIndex={-1}
          data-state={state}
          data-side={side}
          className={cx(surface, className)}
          {...props}
        >
          {children}
          <button type="button" className="ui-modal-close" aria-label={closeLabel} onClick={() => dialog.setOpen(false)}>
            <Icon name="x" />
          </button>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

export function DialogContent(props: ModalContentProps) {
  return <ModalContent surface="ui-dialog" {...props} />;
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-dialog-header", className)} {...props} />;
}

/** The actions, the main one last: on a narrow screen they stack with it on top. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-dialog-footer", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  const dialog = useDialog();
  return <h2 id={dialog.titleId} className={cx("ui-dialog-title", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<"p">) {
  const dialog = useDialog();
  return <p id={dialog.descriptionId} className={cx("ui-dialog-description", className)} {...props} />;
}

/* --------------------------------------------------------------- sheet ---- */

export const Sheet = Dialog;
export const SheetTrigger = DialogTrigger;
export const SheetClose = DialogClose;

export interface SheetContentProps extends ModalContentProps {
  side?: "left" | "right";
}

export function SheetContent({ side = "right", ...props }: SheetContentProps) {
  return <ModalContent surface="ui-sheet" side={side} {...props} />;
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("ui-sheet-header", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<"h2">) {
  const dialog = useDialog();
  return <h2 id={dialog.titleId} className={cx("ui-sheet-title", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<"p">) {
  const dialog = useDialog();
  return <p id={dialog.descriptionId} className={cx("ui-sheet-description", className)} {...props} />;
}
