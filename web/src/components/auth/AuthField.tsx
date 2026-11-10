import { useId, type ComponentProps } from "react";

import { authStyles as styles } from "./AuthFrame";

export interface AuthFieldProps extends ComponentProps<"input"> {
  label: string;
  hint?: string;
  invalid?: boolean;
  /** Pass this only while an error message naming the field is on screen. */
  errorId?: string;
}

/** A labelled input of the account screens, with its hint and error wired up for assistive tech. */
export function AuthField({ label, hint, invalid, errorId, ...input }: AuthFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const describedBy = [hint ? hintId : undefined, errorId].filter(Boolean).join(" ");

  return (
    <div className={styles.field}>
      <label htmlFor={inputId}>{label}</label>
      <input
        {...input}
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p className={styles.fieldHint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
