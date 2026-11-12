"use client";

import { Icon } from "@stellarr/ui/icons";
import { useLanguage } from "@/state/LanguageProvider";

import type { FilePart } from "../parts";

export interface FileAttachmentProps {
  part: FilePart;
  onDownload?(part: FilePart): void;
}

export function FileAttachment({ part, onDownload }: FileAttachmentProps) {
  const { t } = useLanguage();
  return (
    <div className="att att-file" role="group" aria-label={t("attachment.file", { name: part.name })}>
      <span className="ext" aria-hidden="true">
        {part.ext}
      </span>
      <span className="fmeta">
        <b>{part.name}</b>
        <span>{part.size}</span>
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={t("attachment.download", { name: part.name })}
        onClick={onDownload && (() => onDownload(part))}
      >
        <Icon name="download" size={15} />
      </button>
    </div>
  );
}
