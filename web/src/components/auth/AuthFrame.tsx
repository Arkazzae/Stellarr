import type { ReactNode } from "react";

import styles from "./AuthFrame.module.css";
import { StellarrMark } from "./StellarrMark";

export interface AuthFrameProps {
  title: string;
  description: string;
  /** A contextual action placed directly above the heading. */
  headingAction?: ReactNode;
  children: ReactNode;
}

/**
 * The shell every account screen sits in: one centred column on the canvas.
 *
 * The lockup carries the brand, so the heading names the task and the
 * description gets a single line to say why. A second large line competing
 * with the heading is what made these screens read as noise.
 */
export function AuthFrame({ title, description, headingAction, children }: AuthFrameProps) {
  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <header className={styles.header}>
          <p className={styles.brand}>
            <StellarrMark />
            <span>Stellarr</span>
          </p>
          <div className={styles.titles}>
            {headingAction}
            <h1 className={styles.heading}>{title}</h1>
            <p className={styles.description}>{description}</p>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

export { styles as authStyles };
