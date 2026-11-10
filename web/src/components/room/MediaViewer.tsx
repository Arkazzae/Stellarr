"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Icon } from "@/components/icons/Icon";
import { IconButton } from "@/components/primitives/IconButton";
import { Modal } from "@/components/primitives/Modal";
import { useLanguage } from "@/state/hooks";

import { useMediaMenu, type MediaMenuTarget } from "./MediaMenu";

/**
 * What the viewer is showing.
 *
 * One union rather than a viewer per kind: the backdrop, close button, caption
 * and Escape handling are identical, and only the media differs.
 */
export type ViewerTarget =
  | {
      kind: "image";
      /** The whole gallery, so the arrows can move inside it. */
      images: { src: string; alt: string }[];
      index: number;
    }
  | {
      kind: "video";
      /** Empty when the upload carries no playable file. */
      src: string;
      poster?: string;
      name?: string;
    };

export interface MediaViewerProps {
  target: ViewerTarget | null;
  onClose(): void;
}

const LABEL_ID = "media-viewer-title";

/** Travel before a touch is classified as a swipe or as a scroll. */
const SWIPE_START_PX = 8;
/** Horizontal travel that turns a swipe into a step to the next image. */
const SWIPE_STEP_PX = 48;
/** How much one axis must dominate the other, so a diagonal drag is ignored. */
const SWIPE_AXIS_RATIO = 1.15;
/** The most the image follows the finger, so it cannot leave the screen. */
const SWIPE_FOLLOW_MAX_PX = 120;

function startIndex(target: ViewerTarget | null): number {
  return target?.kind === "image" ? target.index : 0;
}

/** A gallery is a ring, so the arrows wrap instead of stopping at an end. */
function stepped(current: number, delta: number, length: number): number {
  return (current + delta + length) % length;
}

/**
 * The media on screen, in the shape the media menu wants.
 *
 * An upload without a file still has its download link and menu, with an empty
 * address, so the header and the right-click behave the same for every video.
 */
function currentMedia(target: ViewerTarget, index: number): MediaMenuTarget {
  if (target.kind === "video") {
    return { kind: "video", src: target.src, name: target.name };
  }
  // An index outside the gallery shows its first image, as the stage does.
  const image = target.images[index] ?? target.images[0];
  return { kind: "image", src: image?.src ?? "", name: image?.alt || undefined };
}

/**
 * The full-screen view behind an image or an uploaded video.
 *
 * It sits on the `Modal` the settings dialogs use, which supplies the focus
 * trap, the Escape handler and the scroll lock.
 */
export function MediaViewer({ target, onClose }: MediaViewerProps) {
  const { t } = useLanguage();
  // The gallery position lives here: nothing outside this dialog cares which
  // image is on screen, and a host would only hand it straight back.
  const [index, setIndex] = useState(() => startIndex(target));
  // A video that will not play leaves only its poster to show.
  const [broken, setBroken] = useState(false);
  const menu = useMediaMenu();

  // State derived from a prop is reset during render, not in an effect: an
  // effect would paint the previous image for one frame before correcting it.
  const [shown, setShown] = useState(target);
  if (shown !== target) {
    setShown(target);
    setIndex(startIndex(target));
    setBroken(false);
  }

  const galleryLength = target?.kind === "image" ? target.images.length : 0;

  useEffect(() => {
    if (galleryLength < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      setIndex((current) => stepped(current, delta, galleryLength));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [galleryLength]);

  const media = target === null ? null : currentMedia(target, index);

  return (
    <Modal open={target !== null} onClose={onClose} labelledBy={LABEL_ID} className="mv-wrap">
      {target === null || media === null ? null : (
        <>
          <div className="mv-bar">
            <h2 id={LABEL_ID}>{caption(target, index, t("media.image"), t("media.video"))}</h2>
            {galleryLength > 1 ? (
              <span className="mv-count" aria-live="polite" aria-atomic="true">
                {index + 1} / {galleryLength}
              </span>
            ) : null}
            <a
              className="icon-btn"
              href={media.src}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("media.download")}
              title={t("media.download")}
              download=""
            >
              <Icon name="download" size={16} />
            </a>
            <IconButton
              icon="x"
              size={18}
              label={t("common.close")}
              title={t("common.close")}
              onClick={onClose}
            />
          </div>

          {/* The empty space around the media closes the viewer like the
              backdrop does, but it still offers the media's own menu: in full
              screen that space is most of what a portrait image leaves, and it
              is where someone who wants to keep the picture will click. */}
          <div
            className="mv-stage"
            onClick={(event) => {
              if (event.target === event.currentTarget) onClose();
            }}
            onContextMenu={menu.onContextMenu(media)}
          >
            {target.kind === "image" ? (
              <ImageStage
                images={target.images}
                index={index}
                onStep={
                  galleryLength > 1
                    ? (delta) => setIndex((current) => stepped(current, delta, galleryLength))
                    : undefined
                }
              />
            ) : target.src === "" || broken ? (
              <MissingVideo poster={target.poster} />
            ) : (
              <video
                className="mv-media"
                src={target.src}
                poster={target.poster}
                controls
                autoPlay
                playsInline
                onError={() => setBroken(true)}
              />
            )}
          </div>
          {menu.node}
        </>
      )}
    </Modal>
  );
}

function caption(
  target: ViewerTarget,
  index: number,
  imageFallback: string,
  videoFallback: string,
): string {
  return target.kind === "image"
    ? (target.images[index]?.alt ?? imageFallback)
    : (target.name ?? videoFallback);
}

interface Swipe {
  pointerId: number;
  x: number;
  y: number;
  axis: "horizontal" | "vertical" | null;
}

/** Ends the drag styling and puts the image back where it started. */
function settle(image: HTMLElement): void {
  image.removeAttribute("data-dragging");
  image.style.setProperty("--mv-drag-x", "0px");
}

function capturePointer(image: HTMLElement, pointerId: number): void {
  try {
    image.setPointerCapture?.(pointerId);
  } catch {
    // A synthetic event has no native pointer to capture; the swipe still works
    // for as long as it stays over the image.
  }
}

function releasePointer(image: HTMLElement, pointerId: number): void {
  try {
    if (image.hasPointerCapture?.(pointerId)) image.releasePointerCapture(pointerId);
  } catch {
    // The browser already dropped the capture, as it does for a system gesture.
  }
}

function ImageStage({
  images,
  index,
  onStep,
}: {
  images: { src: string; alt: string }[];
  index: number;
  /** Absent for a single image, which has nowhere to go. */
  onStep?(delta: number): void;
}) {
  const { t } = useLanguage();
  const current = images[index] ?? images[0];
  const swipe = useRef<Swipe | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // The drag is written straight to the element so that pointer moves do not
  // re-render the viewer sixty times a second. Once a button, a key or a swipe
  // has replaced the image, the leftovers of the gesture are cleared here.
  useEffect(() => {
    swipe.current = null;
    imageRef.current?.removeAttribute("data-dragging");
    imageRef.current?.style.removeProperty("--mv-drag-x");
  }, [index, current?.src]);

  if (current === undefined) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    const touchLike = event.pointerType === "touch" || event.pointerType === "pen";
    if (onStep === undefined || !touchLike || !event.isPrimary) return;
    swipe.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      axis: null,
    };
    event.currentTarget.setAttribute("data-dragging", "");
    capturePointer(event.currentTarget, event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    const active = swipe.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;

    if (active.axis === null && Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_START_PX) {
      if (Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO) active.axis = "horizontal";
      else if (Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS_RATIO) active.axis = "vertical";
    }
    if (active.axis !== "horizontal") return;

    event.preventDefault();
    // The image follows the finger with some resistance, attached to the
    // gesture but never gone before the release decides what it meant.
    const follow = Math.sign(dx) * Math.min(Math.abs(dx), SWIPE_FOLLOW_MAX_PX);
    event.currentTarget.style.setProperty("--mv-drag-x", `${follow}px`);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLImageElement>) => {
    const active = swipe.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    releasePointer(event.currentTarget, event.pointerId);
    swipe.current = null;

    if (active.axis === "horizontal" && Math.abs(dx) >= SWIPE_STEP_PX && onStep !== undefined) {
      // `data-dragging` stays for this render, so the next image snaps to the
      // centre instead of sliding there; the effect above removes it afterwards.
      event.currentTarget.style.setProperty("--mv-drag-x", "0px");
      onStep(dx < 0 ? 1 : -1);
    } else {
      settle(event.currentTarget);
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (swipe.current?.pointerId !== event.pointerId) return;
    releasePointer(event.currentTarget, event.pointerId);
    swipe.current = null;
    settle(event.currentTarget);
  };

  return (
    <>
      {onStep ? (
        <IconButton
          className="mv-nav prev"
          icon="prev"
          size={20}
          label={t("media.previous")}
          title={t("media.previous")}
          onClick={() => onStep(-1)}
        />
      ) : null}
      <img
        ref={imageRef}
        className="mv-media mv-image"
        src={current.src}
        alt={current.alt}
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {onStep ? (
        <IconButton
          className="mv-nav next"
          icon="next"
          size={20}
          label={t("media.next")}
          title={t("media.next")}
          onClick={() => onStep(1)}
        />
      ) : null}
    </>
  );
}

function MissingVideo({ poster }: { poster?: string }) {
  const { t } = useLanguage();
  return (
    <div className="mv-missing">
      {poster === undefined ? null : <img className="mv-media" src={poster} alt="" />}
      <p className="mv-note">{t("media.recordingUnavailable")}</p>
    </div>
  );
}
