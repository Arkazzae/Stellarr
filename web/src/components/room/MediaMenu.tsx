"use client";

import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { ContextMenu, type MenuEntry } from "@/components/primitives/ContextMenu";
import type { Translator } from "@/i18n";
import { useLanguage } from "@/state/hooks";

import {
  absoluteUrl,
  canCopyImages,
  copyImage,
  fileNameFor,
  saveFile,
} from "./mediaActions";

/** What the menu was raised on. A clip has no picture to copy. */
export interface MediaMenuTarget {
  kind: "image" | "video";
  src: string;
  /** Names the saved file; the last segment of the address when absent. */
  name?: string;
}

export interface MediaMenu {
  /** Hang off `onContextMenu` of the picture, the clip or the area around it. */
  onContextMenu(
    target: MediaMenuTarget,
  ): (event: ReactMouseEvent<HTMLElement>) => void;
  /** Render once, anywhere inside the component that owns the menu. */
  node: ReactNode;
}

/** Whatever the clipboard or the download refuses is not worth a dialog. */
function ignoreFailure(): void {}

function entriesFor({ kind, src, name }: MediaMenuTarget, t: Translator): MenuEntry[] {
  const image = kind === "image";
  const entries: MenuEntry[] = [];

  if (image && canCopyImages()) {
    entries.push({
      id: "copy-image",
      label: t("media.copyImage"),
      icon: "copy",
      onSelect: () => void copyImage(src).catch(ignoreFailure),
    });
  }
  entries.push(
    {
      id: "copy-link",
      label: t(image ? "media.copyImageLink" : "media.copyLink"),
      icon: "link",
      onSelect: () =>
        void navigator.clipboard?.writeText(absoluteUrl(src)).catch(ignoreFailure),
    },
    {
      id: "save",
      label: t(image ? "media.saveImage" : "media.saveFile"),
      icon: "download",
      onSelect: () =>
        void saveFile(
          src,
          fileNameFor(src, name, image ? "obraz.png" : "nagranie.mp4"),
        ).catch(ignoreFailure),
    },
    {
      id: "open",
      label: t("media.openInNewTab"),
      icon: "popout",
      onSelect: () => void window.open(src, "_blank", "noopener"),
    },
  );
  return entries;
}

/**
 * The right-click menu for a picture or a clip.
 *
 * The desktop client has no browser menu to fall back on, and the web build's
 * native one cannot copy an image the app has already fetched without
 * downloading it again. One menu serves both, and holding Shift still reaches
 * whatever the browser would have shown.
 */
export function useMediaMenu(): MediaMenu {
  const { t } = useLanguage();
  const [open, setOpen] = useState<{ x: number; y: number; target: MediaMenuTarget } | null>(
    null,
  );
  const close = useCallback(() => setOpen(null), []);

  return {
    onContextMenu: (target) => (event) => {
      if (event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen({ x: event.clientX, y: event.clientY, target });
    },
    node:
      open === null ? null : (
        <ContextMenu
          at={{ x: open.x, y: open.y }}
          entries={entriesFor(open.target, t)}
          label={t(open.target.kind === "image" ? "media.imageMenu" : "media.clipMenu")}
          onClose={close}
        />
      ),
  };
}
