export interface ProviderPlayerFrameProps {
  className: string;
  src: string;
  title: string;
}

/**
 * The one place a third-party video frame is created, and its security contract.
 *
 * It is mounted only after a deliberate click. The sandbox lets the player run
 * but not navigate the Stellarr tab, and the referrer is cut down to our origin:
 * YouTube requires the embedder's identity for playback, never our paths.
 */
export function ProviderPlayerFrame({ className, src, title }: ProviderPlayerFrameProps) {
  return (
    <iframe
      className={className}
      src={src}
      title={title}
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
    />
  );
}
