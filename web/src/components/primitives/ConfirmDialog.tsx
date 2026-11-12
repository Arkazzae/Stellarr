"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/LanguageProvider";

import { Modal } from "./Modal";

/** One line of text the deed needs before it can be done. */
export interface ConfirmField {
  /** The field's own name, shown above it. */
  label: string;
  placeholder?: string;
  maxLength?: number;
  /**
   * Empty is a valid answer. Without this the deed's button stays disabled
   * until something is typed.
   */
  optional?: boolean;
}

export interface ConfirmDialogProps {
  open: boolean;
  /** The question itself: short, and it ends in a question mark. */
  title: string;
  /** What the question does not say, usually the consequence. */
  description?: string;
  /** Names the deed ("Delete", "Block"), never "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** The deed destroys something: red button, red glyph. */
  danger?: boolean;
  /** The icon of the control that raised the question. */
  icon?: IconName;
  /** Turns the question into one that also collects an answer in words. */
  field?: ConfirmField;
  /** Receives the field's contents, trimmed; an empty string without a field. */
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * One question, two answers: the app's own surface in place of
 * `window.confirm`, and with a `field` in place of `window.prompt`.
 *
 * Cancel comes first in the DOM, so the modal's initial focus lands on the
 * harmless answer and a stray Enter costs nothing. A field takes the focus
 * instead, because a question that wants words is answered by typing. The
 * destructive button is styled as such but never focused.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  icon,
  field,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const fieldId = useId();
  const [value, setValue] = useState("");

  // Cleared while rendering rather than in an effect, so a reused dialog is
  // never painted holding the previous answer.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setValue("");
  }

  const answer = value.trim();
  const incomplete = field !== undefined && field.optional !== true && answer === "";

  return (
    <Modal open={open} onClose={onCancel} labelledBy={titleId} className="cf-wrap" exitMs={200}>
      {/* A form, so that Enter in the field answers the question. */}
      <form
        className="cf-card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!incomplete) onConfirm(answer);
        }}
      >
        <div className="cf-head">
          {icon === undefined ? null : (
            <span className={danger ? "cf-ico danger" : "cf-ico"} aria-hidden="true">
              <Icon name={icon} size={18} />
            </span>
          )}
          <div className="cf-copy">
            <h2 id={titleId}>{title}</h2>
            {description === undefined ? null : <p>{description}</p>}
            {field === undefined ? null : (
              <div className="cf-field">
                <label className="fld-lab" htmlFor={fieldId}>
                  {field.label}
                </label>
                <input
                  id={fieldId}
                  className="set-input"
                  type="text"
                  value={value}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  onChange={(event) => setValue(event.target.value)}
                />
              </div>
            )}
          </div>
        </div>
        <div className="cf-foot">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="submit"
            className={danger ? "btn-danger" : "btn-primary"}
            disabled={incomplete}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Everything the dialog renders; answering is the provider's half. */
export type ConfirmRequest = Omit<ConfirmDialogProps, "open" | "onConfirm" | "onCancel">;

/** A question with a line to fill in: the field is the point. */
export interface PromptRequest extends ConfirmRequest {
  field: ConfirmField;
}

/** Resolves true only if the reader pressed the confirming button. */
export type Confirm = (request: ConfirmRequest) => Promise<boolean>;

/** Resolves the typed answer, trimmed, or null if the question was dismissed. */
export type Prompt = (request: PromptRequest) => Promise<string | null>;

interface ConfirmValue {
  confirm: Confirm;
  prompt: Prompt;
}

const ConfirmContext = createContext<ConfirmValue | null>(null);

/**
 * The app's one dialog, and the promises that stand in for `window.confirm`
 * and `window.prompt`.
 *
 * Callers await an answer instead of rendering a dialog of their own because
 * whatever asks (a context menu, a hover toolbar) is usually gone by the time
 * the reader answers, and would take its dialog with it:
 *
 *     if (!(await confirm(deleteMessageConfirmation(t)))) return;
 *
 * Only one question at a time. A second replaces the first, and the first
 * resolves as "no" so that no handler is left waiting forever.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // `request` outlives `open`, so the card still has its text while it fades out.
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  // Resolves with what was typed, or null when the question was dismissed.
  const pendingRef = useRef<((answer: string | null) => void) | null>(null);

  const settle = useCallback((answer: string | null) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    pending?.(answer);
  }, []);

  const ask = useCallback((next: ConfirmRequest) => {
    pendingRef.current?.(null);
    setRequest(next);
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      pendingRef.current = resolve;
    });
  }, []);

  const confirm = useCallback<Confirm>(async (next) => (await ask(next)) !== null, [ask]);

  const value = useMemo<ConfirmValue>(() => ({ confirm, prompt: ask }), [confirm, ask]);

  // A question that leaves with the tree it was asked from was never answered.
  useEffect(() => () => pendingRef.current?.(null), []);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request === null ? null : (
        <ConfirmDialog
          {...request}
          open={open}
          onConfirm={settle}
          onCancel={() => settle(null)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function useConfirmContext(): ConfirmValue {
  const value = useContext(ConfirmContext);
  if (value === null) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return value;
}

export function useConfirm(): Confirm {
  return useConfirmContext().confirm;
}

export function usePrompt(): Prompt {
  return useConfirmContext().prompt;
}
