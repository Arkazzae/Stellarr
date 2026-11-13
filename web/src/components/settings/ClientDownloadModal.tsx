"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { Icon, type IconName } from "@stellarr/ui/icons";
import { Modal } from "@/components/primitives/Modal";
import { DialogHeader } from "@/components/settings/DialogHeader";
import type { ClientRelease } from "@/lib/desktopRelease";
import { formatBytes } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

export interface ClientDownloadModalProps {
  open: boolean;
  onClose(): void;
  loadReleases(signal?: AbortSignal): Promise<ClientRelease[]>;
}

type Releases =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; releases: ClientRelease[] };

/** What each published platform is called, and the mark it carries. */
const PLATFORM: Record<ClientRelease["platform"], { icon: IconName; name: string }> = {
  android: { icon: "mobile", name: "Android" },
  arch: { icon: "cpu", name: "Arch Linux" },
};

function ReleaseOption({
  release,
  published,
}: {
  release: ClientRelease;
  published: Intl.DateTimeFormat;
}) {
  const { t } = useLanguage();
  const platform = PLATFORM[release.platform];

  return (
    <article className="client-option">
      <span className="client-option-ico" aria-hidden="true">
        <Icon name={platform.icon} size={20} />
      </span>
      <div className="client-option-text">
        <b>{platform.name}</b>
        <span>
          {release.architecture} ·{" "}
          {t("desktopRelease.meta", {
            size: formatBytes(release.sizeBytes),
            date: published.format(new Date(release.publishedAt)),
          })}
        </span>
        <small>{t("desktopRelease.version", { version: release.version })}</small>
        <small className="client-option-checksum">
          SHA-256 · <code title={release.sha256}>{release.sha256}</code>
        </small>
      </div>
      <a className="btn-primary sm" href={release.downloadUrl} download={release.fileName}>
        <Icon name="download" size={15} />
        {t("client.download")}
      </a>
    </article>
  );
}

/**
 * Which client to install, raised from the launcher at the foot of the rail
 * beside the other things that are about the app rather than about one server.
 *
 * Never opened by the desktop client: it is the download.
 */
export function ClientDownloadModal({ open, onClose, loadReleases }: ClientDownloadModalProps) {
  const { locale, t } = useLanguage();
  const titleId = useId();
  // Only written from the request's own callbacks, so opening the dialog again
  // shows the last answer while the next one is fetched instead of blanking.
  const [state, setState] = useState<Releases>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    loadReleases(controller.signal).then(
      (releases) => setState({ status: "loaded", releases }),
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "failed" });
        }
      },
    );
    return () => controller.abort();
  }, [open, loadReleases]);

  const published = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", {
        dateStyle: "long",
      }),
    [locale],
  );
  const releases = state.status === "loaded" ? state.releases : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className="act-modal client-modal"
      exitMs={200}
    >
      <div className="am-card">
        <DialogHeader
          titleId={titleId}
          title={t("client.title")}
          detail={t("client.subtitle")}
          onClose={onClose}
          centered
        />

        <div className="dlg-body client-list">
          {state.status === "loading" ? (
            <p className="desktop-release-state" role="status">
              {t("desktopRelease.loading")}
            </p>
          ) : state.status === "failed" ? (
            <p className="desktop-release-state bad" role="alert">
              {t("desktopRelease.failed")}
            </p>
          ) : releases.length === 0 ? (
            <p className="desktop-release-state">{t("client.empty")}</p>
          ) : (
            releases.map((release) => (
              <ReleaseOption key={release.platform} release={release} published={published} />
            ))
          )}

          {/* The browser stays in the same list so the dialog answers both
              questions at once: what can be installed and what is running. */}
          <article className="client-option current">
            <span className="client-option-ico" aria-hidden="true">
              <Icon name="board" size={20} />
            </span>
            <div className="client-option-text">
              <b>{t("client.web")}</b>
              <span>{t("client.webDetail")}</span>
            </div>
            <span className="client-option-tag">{t("client.inUse")}</span>
          </article>

          {releases.some((release) => release.platform === "android") ? (
            <p className="set-note">{t("client.androidInstall")}</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
