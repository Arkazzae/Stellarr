"use client";

import type { GalleryImage, GalleryPart, ImagePart } from "../parts";

/** Gallery tiles are square thumbnails of this size. */
const TILE_PX = 200;

export interface ImageAttachmentProps {
  part: ImagePart | GalleryPart;
  /** Opens the lightbox; without it the images are inert. */
  onOpen?(images: GalleryImage[], index: number): void;
}

export function ImageAttachment({ part, onOpen }: ImageAttachmentProps) {
  if (part.kind === "gallery") {
    return (
      <div className="att att-gallery">
        {part.images.map((image, index) => (
          <img
            key={`${image.src}-${index}`}
            src={image.src}
            alt={image.alt}
            data-media-index={index}
            width={TILE_PX}
            height={TILE_PX}
            loading="lazy"
            onClick={onOpen && (() => onOpen(part.images, index))}
          />
        ))}
      </div>
    );
  }

  // A lone image is a gallery of one, so the viewer takes the same shape
  // and simply has no neighbours to step to.
  const only: GalleryImage[] = [{ src: part.src, alt: part.alt }];

  return (
    <div className="att">
      <img
        className="att-image"
        src={part.src}
        alt={part.alt}
        data-media-index={0}
        width={part.width}
        height={part.height}
        loading="lazy"
        onClick={onOpen && (() => onOpen(only, 0))}
      />
    </div>
  );
}
