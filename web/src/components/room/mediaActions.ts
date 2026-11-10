/**
 * What can be done with a picture or a clip once it is on screen.
 *
 * The desktop client has no browser menu underneath the app's own, because a
 * webview offers none, so copying and saving media exists in our menus or
 * nowhere. The transcript and the full-screen viewer each raise a menu; both
 * take their actions from here so that the two cannot drift apart.
 */

/** The one bitmap type every clipboard implementation accepts. */
const CLIPBOARD_IMAGE_TYPE = "image/png";

/** How long a saved blob's object URL stays valid after the download starts. */
const OBJECT_URL_LIFETIME_MS = 60_000;

export function absoluteUrl(src: string): string {
  try {
    return new URL(src, window.location.href).toString();
  } catch {
    return src;
  }
}

/** False where the clipboard takes no bitmaps at all, as in Firefox. */
export function canCopyImages(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

async function fetchBlob(src: string): Promise<Blob> {
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Fetching ${src} failed`);
  return await response.blob();
}

/** Redraws formats the clipboard rejects, WebP and AVIF in practice, as PNG. */
async function toPng(blob: Blob): Promise<Blob | null> {
  if (blob.type === CLIPBOARD_IMAGE_TYPE) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, CLIPBOARD_IMAGE_TYPE),
    );
  } finally {
    bitmap.close();
  }
}

export async function copyImage(src: string): Promise<void> {
  const png = await toPng(await fetchBlob(src));
  if (png === null) throw new Error("The image could not be encoded for the clipboard");
  await navigator.clipboard.write([new ClipboardItem({ [CLIPBOARD_IMAGE_TYPE]: png })]);
}

/**
 * The given name when there is one, else the last segment of the address's path.
 * A blob: or data: address is read the same way, from whatever follows its scheme.
 */
export function fileNameFor(src: string, name?: string, fallback = "obraz.png"): string {
  const given = name?.trim();
  if (given) return given;
  try {
    const last = new URL(src, window.location.href).pathname.split("/").filter(Boolean).at(-1);
    if (last !== undefined) return decodeURIComponent(last);
  } catch {
    // An address that does not parse, or a malformed escape in its path.
  }
  return fallback;
}

export async function saveFile(src: string, name: string): Promise<void> {
  let href = src;
  let objectUrl: string | null = null;
  try {
    // Saved through a blob, so the file lands in the download folder instead of
    // the webview navigating to an attachment it would rather display.
    objectUrl = URL.createObjectURL(await fetchBlob(src));
    href = objectUrl;
  } catch {
    // A cross-origin source cannot be read, but the direct link still downloads.
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (objectUrl !== null) {
    const stale = objectUrl;
    setTimeout(() => URL.revokeObjectURL(stale), OBJECT_URL_LIFETIME_MS);
  }
}
