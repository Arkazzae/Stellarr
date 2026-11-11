"use client";

import { useLanguage } from "@/state/hooks";

import styles from "./AppSkeleton.module.css";

type Width = "wide" | "medium" | "short";

const CHANNELS: readonly Width[] = ["wide", "medium", "short"];
const VOICE_CHANNELS = CHANNELS.slice(0, 2);
const PEOPLE: readonly Width[] = ["medium", "wide", "short", "medium"];
const MESSAGES: readonly Width[] = ["wide", "medium", "short", "wide", "medium"];
/** Messages that wrap onto a second line, so the column does not look ruled. */
const WRAPPING_MESSAGES: ReadonlySet<number> = new Set([1, 4]);

function Block({ className = "" }: { className?: string }) {
  return <span className={`${styles.block} ${className}`} />;
}

function ServerRailSkeleton() {
  return (
    <nav className={styles.serverRail} aria-hidden="true">
      <Block className={styles.serverTile} />
      <span className={styles.serverDivider} />
      <Block className={styles.serverTile} />
      <Block className={styles.serverLauncher} />
    </nav>
  );
}

function RailSkeleton() {
  return (
    <nav className={styles.rail} aria-hidden="true">
      <div className={styles.railHeader}>
        <Block className={styles.serverName} />
        <Block className={styles.roundControl} />
        <Block className={styles.roundControl} />
      </div>

      <div className={styles.railScroll}>
        <section className={styles.channelGroup}>
          <Block className={styles.groupLabel} />
          <div className={styles.channelList}>
            {CHANNELS.map((width, index) => (
              <div className={styles.channel} key={index}>
                <Block className={styles.channelGlyph} />
                <Block className={styles[`${width}Channel`]} />
              </div>
            ))}
          </div>
        </section>

        <section className={styles.channelGroup}>
          <Block className={styles.groupLabelShort} />
          <div className={styles.channelList}>
            {VOICE_CHANNELS.map((width, index) => (
              <div className={styles.channel} key={index}>
                <Block className={styles.channelGlyph} />
                <Block className={styles[`${width}Channel`]} />
                <Block className={styles.channelCount} />
              </div>
            ))}
            <div className={styles.occupant}>
              <Block className={styles.avatarXs} />
              <Block className={styles.occupantName} />
            </div>
            <div className={styles.occupant}>
              <Block className={styles.avatarXs} />
              <Block className={styles.occupantNameShort} />
            </div>
          </div>
        </section>
      </div>

      <div className={styles.account}>
        <Block className={styles.avatarSm} />
        <span className={styles.accountCopy}>
          <Block className={styles.accountName} />
          <Block className={styles.accountStatus} />
        </span>
        <Block className={styles.squareControl} />
      </div>
    </nav>
  );
}

function RoomSkeleton() {
  return (
    <main className={styles.room} aria-hidden="true">
      <header className={styles.roomHeader}>
        <Block className={styles.mobileMenu} />
        <Block className={styles.roomGlyph} />
        <Block className={styles.roomName} />
        <Block className={styles.topic} />
        {/* The three actions every room header carries once it has loaded. */}
        <span className={styles.headerTools}>
          <Block className={styles.roundControl} />
          <Block className={styles.roundControl} />
          <Block className={styles.rosterControl} />
        </span>
      </header>

      <div className={styles.roomBody}>
        <div className={styles.transcript}>
          <div className={styles.messageList}>
            <div className={styles.daySeparator}>
              <span />
              <Block className={styles.dayLabel} />
              <span />
            </div>
            {MESSAGES.map((width, index) => (
              <div className={styles.message} key={index}>
                <Block className={styles.avatarMd} />
                <div className={styles.messageCopy}>
                  <div className={styles.messageMeta}>
                    <Block className={styles.author} />
                    <Block className={styles.timestamp} />
                  </div>
                  <Block className={styles[`${width}Message`]} />
                  {WRAPPING_MESSAGES.has(index) ? (
                    <Block className={styles.secondMessageLine} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.composer}>
          <div className={styles.composerBox}>
            <Block className={styles.composerLead} />
            <Block className={styles.composerLine} />
            <Block className={styles.composerAction} />
            <Block className={`${styles.composerAction} ${styles.composerSendAction}`} />
          </div>
        </div>
      </div>
    </main>
  );
}

function PeopleGroup({
  labelClass,
  people,
}: {
  labelClass: string | undefined;
  people: readonly Width[];
}) {
  return (
    <section className={styles.peopleGroup}>
      <Block className={labelClass} />
      {people.map((width, index) => (
        <div className={styles.person} key={index}>
          <Block className={styles.avatarSm} />
          <Block className={styles[`${width}Person`]} />
        </div>
      ))}
    </section>
  );
}

function RosterSkeleton() {
  return (
    <aside className={styles.roster} aria-hidden="true">
      <div className={styles.rosterMini}>
        <Block className={styles.squareControl} />
        {PEOPLE.map((_, index) => (
          <Block className={styles.avatarSm} key={index} />
        ))}
      </div>

      <div className={styles.rosterFull}>
        <div className={styles.rosterHeader}>
          <Block className={styles.roomGlyph} />
          <Block className={styles.rosterTitle} />
          <Block className={styles.squareControl} />
        </div>
        <div className={styles.rosterList}>
          <PeopleGroup labelClass={styles.groupLabel} people={PEOPLE.slice(0, 2)} />
          <PeopleGroup labelClass={styles.groupLabelShort} people={PEOPLE.slice(2)} />
        </div>
      </div>
    </aside>
  );
}

export interface AppSkeletonProps {
  /** Read once by assistive tech while the app bootstraps. */
  label?: string;
}

/**
 * A geometry-faithful preview of the signed-in shell, so loading does not move
 * anything when the real one arrives.
 *
 * It has no shimmer on purpose: Stellarr animates state changes only. The
 * placeholder surfaces already say that content is on its way, and standing
 * still is easier on dim screens and slow hardware.
 */
export function AppSkeleton({ label }: AppSkeletonProps) {
  const { t } = useLanguage();
  const accessibleLabel = label ?? t("app.loading");

  return (
    <div className={styles.shell} role="region" aria-busy="true" aria-label={accessibleLabel}>
      <ServerRailSkeleton />
      <RailSkeleton />
      <RoomSkeleton />
      <RosterSkeleton />
      <span className="sr-only" role="status">
        {accessibleLabel}
      </span>
    </div>
  );
}
