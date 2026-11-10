"use client";

import { useId } from "react";

import { Icon } from "@/components/icons/Icon";
import { ErrorNotice } from "@/components/primitives/ErrorNotice";
import type { Translator } from "@/i18n";
import type { JoinSoundPicker } from "@/ports";
import { useLanguage } from "@/state/hooks";

/** The line under the picker, which says why the list may be missing or empty. */
function pickerStatus(joinSound: JoinSoundPicker, t: Translator): string {
  if (joinSound.loading) return t("voice.joinSoundLoading");
  if (!joinSound.selectionAvailable) return t("voice.joinSoundUnavailableHint");
  if (joinSound.servers.length === 0 && !joinSound.failed) return t("voice.joinSoundEmpty");
  return "";
}

/**
 * What the room hears from you before you say anything.
 *
 * It sits with the rest of your public identity on the account pane: like your
 * name and your face, it is something other people are made to experience, not
 * a setting of your own call. It saves the moment it changes, apart from the
 * profile form above it, because it is chosen by ear and not typed.
 */
export function JoinSoundSection({ joinSound }: { joinSound: JoinSoundPicker }) {
  const { t } = useLanguage();
  const selectId = useId();

  return (
    <section className="sc acc-join-sound">
      <header className="sc-h">
        <span className="sc-ico" aria-hidden="true">
          <Icon name="sound" size={17} />
        </span>
        {t("voice.joinSound")}
      </header>
      <div className="sc-b">
        <div className="frm">
          <div className="frm-row">
            <label className="frm-lab" htmlFor={selectId}>
              {t("voice.joinSoundChoice")}
              <span>
                {t("voice.joinSoundDetail", { seconds: Math.round(joinSound.maxSeconds) })}
              </span>
            </label>
            <div className="frm-ctl">
              <div className="join-sound-row">
                <select
                  id={selectId}
                  className="set-select"
                  value={joinSound.selectedId ?? ""}
                  onChange={(event) =>
                    joinSound.select(event.target.value === "" ? null : event.target.value)}
                >
                  <option value="">{t("voice.joinSoundNone")}</option>
                  {/* A choice whose server was left is still the stored one.
                      Leaving it out of the list would rewrite the setting to
                      "none" the moment this pane opened. */}
                  {joinSound.selectionAvailable ? null : (
                    <option value={joinSound.selectedId ?? ""}>
                      {t("voice.joinSoundUnavailable")}
                    </option>
                  )}
                  {joinSound.servers.map((group) => (
                    <optgroup key={group.serverId} label={group.serverName}>
                      {group.sounds.map((sound) => (
                        <option key={sound.id} value={sound.id}>
                          {`${sound.glyph} ${sound.name}`}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost sm"
                  disabled={joinSound.selectedId === null || !joinSound.selectionAvailable}
                  onClick={() => joinSound.preview()}
                >
                  <Icon name="play" size={15} />
                  {t("voice.joinSoundPreview")}
                </button>
              </div>
              <p className="pf-count" role="status">{pickerStatus(joinSound, t)}</p>
              {joinSound.failed ? (
                <ErrorNotice
                  compact
                  title={t("voice.joinSoundFailed")}
                  message={t("voice.joinSoundFailedDetail")}
                  icon="sound"
                  actions={[{ label: t("common.tryAgain"), onClick: joinSound.reload }]}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
