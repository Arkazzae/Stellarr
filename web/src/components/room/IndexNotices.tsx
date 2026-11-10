"use client";

import { useLanguage } from "@/state/hooks";

/** Why a page of the channel index did not arrive, with a retry when the host has one. */
export function IndexError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?(): void;
}) {
  const { t } = useLanguage();
  return (
    <div className="cp-index-error" role="alert">
      <span>{message}</span>
      {onRetry === undefined ? null : (
        <button type="button" onClick={onRetry}>
          {t("room.retry")}
        </button>
      )}
    </div>
  );
}

/** Asks for the next, older page of the channel index; inert while one is on its way. */
export function LoadOlderButton({
  loading,
  onLoad,
}: {
  loading: boolean;
  onLoad?(): void;
}) {
  const { t } = useLanguage();
  return (
    <button type="button" className="cp-more" disabled={loading} onClick={onLoad}>
      {loading ? t("common.loading") : t("room.loadOlderIndex")}
    </button>
  );
}
