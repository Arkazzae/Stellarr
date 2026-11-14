"use client";

import { Button } from "@stellarr/ui";
import { Icon, type IconName } from "@stellarr/ui/icons";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useLanguage } from "@/state/hooks";

export interface SettingsChannelVM {
  id: string;
  name: string;
  kind: "text" | "voice";
  /** Which section owns it; the sections list counts its channels from these. */
  sectionId?: string;
}

export interface SettingsSectionVM {
  id: string;
  name: string;
}

export interface ChannelsPaneProps {
  supported: boolean;
  channels: readonly SettingsChannelVM[];
  onAdd: () => void;
  onEdit: (channelId: string) => void;
  /** False when this member may not manage channels, so sections are read-only. */
  sectionsSupported: boolean;
  sections: readonly SettingsSectionVM[];
  onAddSection: () => void;
  onEditSection: (sectionId: string) => void;
  onMoveSectionUp: (sectionId: string) => Promise<void>;
  onMoveSectionDown: (sectionId: string) => Promise<void>;
}

/** The rail's own glyphs, so a channel looks the same in both places. */
const KIND_ICON: Record<SettingsChannelVM["kind"], IconName> = {
  text: "hash",
  voice: "speaker",
};

/**
 * Sections and channels as two management lists.
 *
 * Channels are reordered by dragging them in the rail, so the rows here only
 * offer "edit"; sections have no drag, and get an up/down pair instead.
 */
export function ChannelsPane({
  supported,
  channels,
  onAdd,
  onEdit,
  sectionsSupported,
  sections,
  onAddSection,
  onEditSection,
  onMoveSectionUp,
  onMoveSectionDown,
}: ChannelsPaneProps) {
  const { t } = useLanguage();
  const move = useAsyncAction();

  const channelsPerSection = new Map<string, number>();
  for (const channel of channels) {
    if (channel.sectionId === undefined) continue;
    channelsPerSection.set(channel.sectionId, (channelsPerSection.get(channel.sectionId) ?? 0) + 1);
  }

  return (
    <>
      {supported ? null : <p className="set-note">{t("settings.unsupported")}</p>}
      <SettingsSection
        title={t("server.railSections")}
        count={sections.length}
        countLabel={t("settings.sectionsCount", { count: sections.length })}
        action={
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="asset-add"
            disabled={!sectionsSupported}
            onClick={onAddSection}
          >
            <Icon name="plus" size={15} />
            {t("section.new")}
          </Button>
        }
      >
        <p className="settings-section-note">{t("server.sectionsDetail")}</p>
        {move.failed ? (
          <p className="set-note sound-error" role="alert">
            {t("section.reorderFailed")}
          </p>
        ) : null}
        {sections.length === 0 ? (
          <div className="asset-empty">
            <Icon name="folder" size={24} />
            <b>{t("server.sectionsEmpty")}</b>
            <span>{t("server.sectionsEmptyDetail")}</span>
          </div>
        ) : (
          <div className="int-list">
            {sections.map((section, index) => (
              <div className="int-row has-move" key={section.id}>
                <span className="int-mark ico" aria-hidden="true">
                  <Icon name="folder" size={17} />
                </span>
                <span className="int-txt">
                  <b>{section.name}</b>
                  <span>
                    {t("settings.channelsCount", { count: channelsPerSection.get(section.id) ?? 0 })}
                  </span>
                </span>
                <span className="int-move">
                  <button
                    type="button"
                    title={t("section.moveUp")}
                    disabled={!sectionsSupported || move.pending || index === 0}
                    aria-label={t("section.moveUpNamed", { name: section.name })}
                    onClick={() => void move.run(() => onMoveSectionUp(section.id))}
                  >
                    <Icon name="caret" size={11} />
                  </button>
                  <button
                    type="button"
                    title={t("section.moveDown")}
                    disabled={!sectionsSupported || move.pending || index === sections.length - 1}
                    aria-label={t("section.moveDownNamed", { name: section.name })}
                    onClick={() => void move.run(() => onMoveSectionDown(section.id))}
                  >
                    <Icon name="caret" size={11} />
                  </button>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!sectionsSupported}
                  aria-label={t("settings.editSection", { name: section.name })}
                  onClick={() => onEditSection(section.id)}
                >
                  {t("common.edit")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
      <SettingsSection
        title={t("server.channels")}
        count={channels.length}
        countLabel={t("settings.channelsCount", { count: channels.length })}
        action={
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="asset-add"
            disabled={!supported}
            onClick={onAdd}
          >
            <Icon name="plus" size={15} />
            {t("settings.addChannel")}
          </Button>
        }
      >
        <p className="settings-section-note">{t("settings.channelOrder")}</p>
        {channels.length === 0 ? (
          <div className="asset-empty">
            <Icon name="hash2" size={24} />
            <b>{t("settings.channelsEmpty")}</b>
            <span>{t("settings.channelsEmptyDetail")}</span>
          </div>
        ) : (
          <div className="int-list">
            {channels.map((channel) => (
              <div className="int-row" key={channel.id}>
                <span className="int-mark ico" aria-hidden="true">
                  <Icon name={KIND_ICON[channel.kind]} size={17} />
                </span>
                <span className="int-txt">
                  <b>{channel.name}</b>
                  <span>{channel.kind === "text" ? t("channel.text") : t("channel.voice")}</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!supported}
                  aria-label={t("settings.editChannel", { name: channel.name })}
                  onClick={() => onEdit(channel.id)}
                >
                  {t("common.edit")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
