"use client";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "@stellarr/ui/icons";
import type { DesktopRelease } from "@/lib/desktopRelease";
import { formatBytes } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

export interface DesktopReleasePaneProps {
  loadRelease(signal?: AbortSignal): Promise<DesktopRelease | null>;
}

type Lookup =
  | { status: "loading" }
  | { status: "failed" }
  /** `release` is null when the instance has not published a package. */
  | { status: "done"; release: DesktopRelease | null };

export function DesktopReleasePane({ loadRelease }: DesktopReleasePaneProps) {
  const { locale, t } = useLanguage();
  const [lookup, setLookup] = useState<Lookup>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void loadRelease(controller.signal).then(
      (release) => {
        if (!controller.signal.aborted) setLookup({ status: "done", release });
      },
      () => {
        if (!controller.signal.aborted) setLookup({ status: "failed" });
      },
    );
    return () => controller.abort();
  }, [loadRelease]);

  const release = lookup.status === "done" ? lookup.release : null;
  const published = useMemo(
    () => release === null
      ? ""
      : new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", {
          dateStyle: "long",
        }).format(new Date(release.publishedAt)),
    [locale, release],
  );

  return (
    <section className="sc desktop-release">
      <header className="sc-h">
        <span className="sc-ico" aria-hidden="true">
          <Icon name="download" size={17} />
        </span>
        {t("desktopRelease.sectionTitle")}
      </header>
      <div className="sc-b desktop-release-body">
        {lookup.status === "loading" ? (
          <p className="desktop-release-state" role="status">
            {t("desktopRelease.loading")}
          </p>
        ) : lookup.status === "failed" ? (
          <p className="desktop-release-state bad" role="alert">
            {t("desktopRelease.failed")}
          </p>
        ) : release === null ? (
          <p className="desktop-release-state">{t("desktopRelease.empty")}</p>
        ) : (
          <>
            <div className="desktop-release-copy">
              <div>
                <b>{t("desktopRelease.version", { version: release.version })}</b>
                <span>
                  {t("desktopRelease.meta", {
                    size: formatBytes(release.sizeBytes),
                    date: published,
                  })}
                </span>
              </div>
              <a className="btn-primary" href={release.downloadUrl} download={release.fileName}>
                <Icon name="download" size={15} />
                {t("desktopRelease.download")}
              </a>
            </div>
            <p className="desktop-release-notes">{release.notes}</p>
            <dl className="desktop-release-details">
              <div>
                <dt>{t("desktopRelease.system")}</dt>
                <dd>Arch Linux · x86_64</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd><code title={release.sha256}>{release.sha256}</code></dd>
              </div>
            </dl>
            <p className="set-note desktop-release-install">
              {t("desktopRelease.install", { fileName: release.fileName })}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
