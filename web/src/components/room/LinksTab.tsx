"use client";

import { Icon } from "@/components/icons/Icon";
import { formatFull } from "@/lib/format";
import { useLanguage } from "@/state/hooks";

import type { LinkItemVM } from "./channelPanelModel";
import { IndexedTab, type IndexStatus } from "./IndexedTab";

export function LinksTab({
  links,
  status,
}: {
  links: LinkItemVM[];
  status: IndexStatus;
}) {
  const { locale, t } = useLanguage();

  return (
    <IndexedTab
      status={status}
      empty={links.length === 0}
      emptyText={t("room.noLinksInChannel")}
    >
      <ul className="cp-list">
        {links.map((link) => (
          <li key={link.id}>
            <a
              className="cp-row"
              href={link.href}
              target="_blank"
              rel="ugc nofollow noopener noreferrer"
            >
              {link.thumb === undefined ? (
                <span className="cp-favicon" aria-hidden="true">
                  <Icon name="link" size={14} />
                </span>
              ) : (
                <img className="cp-thumb" src={link.thumb} alt="" loading="lazy" />
              )}
              <span className="cp-meta">
                <b>{link.title}</b>
                <span>{link.domain}</span>
                <span>
                  {link.authorName} · {formatFull(link.timestamp, locale)}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </IndexedTab>
  );
}
