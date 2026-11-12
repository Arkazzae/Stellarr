"use client";

import { Icon } from "@stellarr/ui/icons";
import { formatFull } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

import type { MediaItemVM } from "./channelPanelModel";
import { IndexedTab, type IndexStatus } from "./IndexedTab";
import type {
  AttachmentCallbacks,
  AudioPart,
  FilePart,
  ImagePart,
  VideoPart,
} from "./parts";

/** What the grid shows as a tile, and what the list shows as a row. */
type TileItem = MediaItemVM & { part: ImagePart | VideoPart };
type RowItem = MediaItemVM & { part: FilePart | AudioPart };

const isTile = (item: MediaItemVM): item is TileItem =>
  item.part.kind === "image" || item.part.kind === "video";
const isRow = (item: MediaItemVM): item is RowItem =>
  item.part.kind === "file" || item.part.kind === "audio";

function ImageTile({
  part,
  when,
  onOpen,
}: {
  part: ImagePart;
  when: string;
  onOpen(): void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className="cp-tile"
      title={when}
      aria-label={t("room.zoomImage", { alt: part.alt, when })}
      onClick={onOpen}
    >
      <img src={part.src} alt={part.alt} loading="lazy" />
    </button>
  );
}

function VideoTile({
  part,
  when,
  onPlay,
}: {
  part: VideoPart;
  when: string;
  onPlay?(part: VideoPart): void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className="cp-tile video"
      title={when}
      aria-label={t("room.playRecording", { name: part.name ?? t("room.recording"), when })}
      onClick={() => onPlay?.(part)}
    >
      {part.thumb === undefined ? (
        <span className="cp-noposter" aria-hidden="true" />
      ) : (
        <img src={part.thumb} alt="" loading="lazy" />
      )}
      <span className="cp-play" aria-hidden="true">
        <span>
          <Icon name="play" size={14} />
        </span>
      </span>
      {part.duration === undefined ? null : <span className="cp-dur">{part.duration}</span>}
    </button>
  );
}

/** An uploaded file or a voice note: a row that downloads, never a tile. */
function FileRow({ item }: { item: RowItem }) {
  const { locale, t } = useLanguage();
  const { part } = item;
  const detail =
    part.kind === "file" ? part.size : (part.duration ?? t("room.voiceRecording"));
  const body = (
    <>
      <span className="cp-ext" aria-hidden="true">
        {part.kind === "file" ? part.ext : "AUD"}
      </span>
      <span className="cp-meta">
        <b>{part.name}</b>
        <span>{detail}</span>
        <span>
          {item.authorName} · {formatFull(item.timestamp, locale)}
        </span>
      </span>
    </>
  );

  // A file without a URL is an upload still in flight: listed, but not yet a link.
  if (part.url === undefined || part.url.length === 0) {
    return <span className="cp-row inert">{body}</span>;
  }
  return (
    <a
      className="cp-row"
      href={part.url}
      target="_blank"
      rel="noopener noreferrer"
      download={part.name}
    >
      {body}
    </a>
  );
}

/**
 * Pictures and clips as a grid, files and voice notes as a list under it.
 * Opening a picture hands the viewer every picture in the grid, in the order
 * shown, so it steps through what the reader is looking at rather than through
 * the transcript underneath.
 */
export function MediaTab({
  media,
  status,
  callbacks,
}: {
  media: MediaItemVM[];
  status: IndexStatus;
  callbacks?: AttachmentCallbacks;
}) {
  const { locale, t } = useLanguage();
  const tiles = media.filter(isTile);
  const rows = media.filter(isRow);
  const images = tiles.flatMap(({ id, part }) =>
    part.kind === "image" ? [{ id, src: part.src, alt: part.alt }] : [],
  );
  const gallery = images.map(({ src, alt }) => ({ src, alt }));

  return (
    <IndexedTab
      status={status}
      empty={media.length === 0}
      emptyText={t("room.noMediaInChannel")}
    >
      {tiles.length === 0 ? null : (
        <div className="cp-grid">
          {tiles.map((item) => {
            const { part } = item;
            const when = `${item.authorName} · ${formatFull(item.timestamp, locale)}`;
            return part.kind === "image" ? (
              <ImageTile
                key={item.id}
                part={part}
                when={when}
                onOpen={() =>
                  callbacks?.onOpenImage?.(
                    gallery,
                    images.findIndex((image) => image.id === item.id),
                  )
                }
              />
            ) : (
              <VideoTile
                key={item.id}
                part={part}
                when={when}
                onPlay={callbacks?.onPlayVideo}
              />
            );
          })}
        </div>
      )}
      {rows.length === 0 ? null : (
        <>
          <p className="group-caption cp-caption">{t("room.files")}</p>
          <ul className="cp-list">
            {rows.map((item) => (
              <li key={item.id}>
                <FileRow item={item} />
              </li>
            ))}
          </ul>
        </>
      )}
    </IndexedTab>
  );
}
