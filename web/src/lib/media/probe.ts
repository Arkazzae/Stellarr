/** Metadata measured from the exact local file before it is uploaded. */
export interface UploadMediaMetadata {
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** A bounded JPEG frame generated from a local video. */
  poster?: Blob;
  /** Marks audio captured in the composer rather than uploaded as a file. */
  voiceMessage?: boolean;
}

/** Budget for the whole probe; a file that is not readable by then is uploaded as it is. */
const PROBE_TIMEOUT_MS = 10_000;
const FRAME_TIMEOUT_MS = 3_000;
const POSTER_MAX_WIDTH = 960;
const POSTER_MAX_HEIGHT = 540;
const POSTER_JPEG_QUALITY = 0.82;

/**
 * Lets the browser's own decoders inspect a file about to be uploaded. What
 * this browser cannot decode yields no optional metadata, never an error, and
 * the file still uploads.
 */
export async function probeMedia(file: File): Promise<UploadMediaMetadata> {
  if (file.type.startsWith("image/")) return probeImage(file);
  if (file.type.startsWith("video/")) return probePlayable(file, "video");
  if (file.type.startsWith("audio/")) return probePlayable(file, "audio");
  return {};
}

async function probeImage(file: File): Promise<UploadMediaMetadata> {
  if (typeof createImageBitmap !== "function") return {};
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    return { width, height };
  } catch {
    return {};
  }
}

async function probePlayable(
  file: File,
  kind: "audio" | "video",
): Promise<UploadMediaMetadata> {
  if (typeof document === "undefined") return {};

  const video = kind === "video" ? document.createElement("video") : null;
  const element: HTMLMediaElement = video ?? document.createElement("audio");
  if (video) {
    // A poster needs one decoded frame on top of the container metadata.
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
  } else {
    element.preload = "metadata";
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<UploadMediaMetadata>((resolve) => {
      const timer = setTimeout(() => resolve({}), PROBE_TIMEOUT_MS);
      const settle = (metadata: UploadMediaMetadata) => {
        clearTimeout(timer);
        resolve(metadata);
      };
      element.onerror = () => settle({});
      element.onloadedmetadata = () => {
        measure(element, video).then(settle, () => settle({}));
      };
      element.src = url;
      element.load();
    });
  } finally {
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
  }
}

async function measure(
  element: HTMLMediaElement,
  video: HTMLVideoElement | null,
): Promise<UploadMediaMetadata> {
  const metadata: UploadMediaMetadata = {};
  if (Number.isFinite(element.duration) && element.duration > 0) {
    metadata.durationSeconds = element.duration;
  }
  if (video === null) return metadata;

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    metadata.width = video.videoWidth;
    metadata.height = video.videoHeight;
  }
  const poster = await capturePoster(video);
  if (poster !== undefined) metadata.poster = poster;
  return metadata;
}

async function capturePoster(video: HTMLVideoElement): Promise<Blob | undefined> {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA &&
    !(await frameLoaded(video))
  ) {
    return undefined;
  }
  const { videoWidth, videoHeight } = video;
  if (videoWidth <= 0 || videoHeight <= 0) return undefined;

  const scale = Math.min(1, POSTER_MAX_WIDTH / videoWidth, POSTER_MAX_HEIGHT / videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(videoWidth * scale));
  canvas.height = Math.max(1, Math.round(videoHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) return undefined;

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", POSTER_JPEG_QUALITY);
  });
}

/** Resolves true once the first frame is decoded, false if that takes too long. */
function frameLoaded(video: HTMLVideoElement): Promise<boolean> {
  return new Promise((resolve) => {
    const onLoaded = () => finish(true);
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onLoaded);
      resolve(loaded);
    };
    const timer = setTimeout(() => finish(false), FRAME_TIMEOUT_MS);
    video.addEventListener("loadeddata", onLoaded, { once: true });
  });
}
