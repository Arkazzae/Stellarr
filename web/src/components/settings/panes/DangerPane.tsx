"use client";

import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useLanguage } from "@/state/hooks";

export interface DangerPaneProps {
  supported: boolean;
  /** The delete button spells the server out: "Usuń Orbit". */
  serverName: string;
  onTransfer: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export function DangerPane({ supported, serverName, onTransfer, onDelete }: DangerPaneProps) {
  const { t } = useLanguage();
  const action = useAsyncAction();
  const locked = !supported || action.pending;

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.dangerUnsupported")}</p>}
      <SettingsSection title={t("server.danger")} icon="trash" className="danger-section">
        {action.failed ? (
          <p className="set-note sound-error" role="alert">
            {t("settings.serverActionFailed")}
          </p>
        ) : null}
        <div className="set-row">
          <span className="set-lab">
            <b>{t("settings.transferServer")}</b>
            <span>{t("settings.transferServerDetail")}</span>
          </span>
          <span className="set-ctl">
            <button
              type="button"
              className="btn-ghost"
              disabled={locked}
              onClick={() => void action.run(onTransfer)}
            >
              {t("settings.transfer")}
            </button>
          </span>
        </div>
        <div className="set-row danger">
          <span className="set-lab">
            <b>{t("settings.deleteServer")}</b>
            <span>{t("settings.deleteServerDetail")}</span>
          </span>
          <span className="set-ctl">
            <button
              type="button"
              className="btn-danger"
              disabled={locked}
              onClick={() => void action.run(onDelete)}
            >
              {t("settings.deleteNamedServer", { name: serverName })}
            </button>
          </span>
        </div>
      </SettingsSection>
    </>
  );
}
