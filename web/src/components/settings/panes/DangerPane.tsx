"use client";

import { Button } from "@stellarr/ui";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useLanguage } from "@/state/hooks";

export interface DangerPaneProps {
  supported: boolean;
  /** The delete button spells the server out: "Delete Orbit". */
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
            <Button
              type="button"
              variant="secondary"
              disabled={locked}
              onClick={() => void action.run(onTransfer)}
            >
              {t("settings.transfer")}
            </Button>
          </span>
        </div>
        <div className="set-row danger">
          <span className="set-lab">
            <b>{t("settings.deleteServer")}</b>
            <span>{t("settings.deleteServerDetail")}</span>
          </span>
          <span className="set-ctl">
            <Button
              type="button"
              variant="danger"
              disabled={locked}
              onClick={() => void action.run(onDelete)}
            >
              {t("settings.deleteNamedServer", { name: serverName })}
            </Button>
          </span>
        </div>
      </SettingsSection>
    </>
  );
}
