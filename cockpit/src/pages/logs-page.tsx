import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  cx,
  Input,
  Label,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@stellarr/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { CardTitleRow } from "@/components/card-title-row";
import { Icon } from "@/components/icons/icon";
import { PageHeader } from "@/components/page-header";
import { getLocale, t, type MessageKey } from "@/i18n";
import { formatDateTime, formatNumber } from "@/i18n/format";
import { cockpitApi, type CockpitLogEntry, type CockpitLogLevel } from "@/lib/api";
import { useLogFeed } from "@/lib/use-log-feed";

const SEARCH_DELAY_MS = 300;

const LEVELS: readonly { level: CockpitLogLevel; labelKey: MessageKey }[] = [
  { level: "info", labelKey: "logs.filter.info" },
  { level: "warn", labelKey: "logs.filter.warn" },
  { level: "error", labelKey: "logs.filter.error" },
];

/** The value, once it has stopped changing for `delay` milliseconds. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function LevelBadge({ level }: { level: CockpitLogLevel }) {
  if (level === "error") return <Badge variant="destructive">{t("logs.level.error")}</Badge>;
  if (level === "warn") return <Badge variant="warning">{t("logs.level.warn")}</Badge>;
  return <Badge variant="outline">{t("logs.level.info")}</Badge>;
}

function formatClock(at: string): string {
  return new Date(at).toLocaleTimeString(getLocale() === "pl" ? "pl-PL" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** One line; the message is clamped to two lines until it is opened. */
function LogRow({ entry, open, onToggle }: { entry: CockpitLogEntry; open: boolean; onToggle: () => void }) {
  return (
    <TableRow>
      <TableCell className="pt-2.5 align-top font-mono text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(entry.at)}>
        {formatClock(entry.at)}
      </TableCell>
      <TableCell className="align-top">
        <LevelBadge level={entry.level} />
      </TableCell>
      <TableCell className="hidden pt-2.5 align-top truncate font-mono text-xs md:table-cell" title={entry.source}>
        {entry.source}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cx("break-words whitespace-pre-wrap", open ? "block" : "line-clamp-2")}>{entry.message}</span>
        </button>
        {open ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt>{t("logs.col.time")}</dt>
            <dd className="font-mono">{formatDateTime(entry.at)}</dd>
            <dt>{t("logs.col.source")}</dt>
            <dd className="font-mono break-all">{entry.source}</dd>
            <dt>{t("logs.col.trace")}</dt>
            <dd className="font-mono break-all">{entry.traceId}</dd>
          </dl>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function LogsPage() {
  const [levels, setLevels] = useState<CockpitLogLevel[]>([]);
  const [source, setSource] = useState("");
  const [searchText, setSearchText] = useState("");
  const search = useSettled(searchText, SEARCH_DELAY_MS);
  const filters = useMemo(() => ({ levels, source, search }), [levels, source, search]);
  const feed = useLogFeed(filters, t("logs.loadFailed"));
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, loadMore, loading, loadingMore } = feed;

  // Reading on as the end of the list scrolls into view; the button below does the same by hand.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) void loadMore();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading]);

  const filtered = levels.length > 0 || source !== "" || searchText.trim() !== "";
  const sources = feed.summary?.sources ?? [];
  const knownSource = source === "" || sources.some((entry) => entry.name === source);

  function toggleLevel(level: CockpitLogLevel) {
    setLevels((current) =>
      current.includes(level) ? current.filter((value) => value !== level) : [...current, level],
    );
  }

  function toggleOpened(sequence: number) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(sequence)) next.delete(sequence);
      else next.add(sequence);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader
        title={t("logs.title")}
        description={t("logs.description")}
        actions={
          <>
            <Button variant="secondary" onClick={feed.reload} disabled={loading}>
              {loading ? <Spinner /> : null}
              {t("logs.refresh")}
            </Button>
            <Button variant="secondary" asChild>
              <a href={cockpitApi.logExportUrl(filters)} download>
                {t("logs.export")}
              </a>
            </Button>
          </>
        }
      />

      {feed.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("logs.error")}</AlertTitle>
          <AlertDescription>{feed.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-60 flex-1">
          <Icon name="search" className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t("logs.search")}
            aria-label={t("logs.search")}
            className="rounded-full pl-9"
          />
        </div>
        <div role="group" aria-label={t("logs.levels")} className="flex flex-wrap gap-1.5">
          {LEVELS.map(({ level, labelKey }) => (
            <Button
              key={level}
              type="button"
              variant="secondary"
              aria-pressed={levels.includes(level)}
              onClick={() => toggleLevel(level)}
            >
              {t(labelKey)}
              {feed.summary ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatNumber(feed.summary.levels[level])}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="log-source" className="sr-only">
            {t("logs.source")}
          </Label>
          <select
            id="log-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="h-9 max-w-72 rounded-full border border-input bg-background px-4 text-sm"
          >
            <option value="">{t("logs.source.all")}</option>
            {knownSource ? null : <option value={source}>{source}</option>}
            {sources.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name} ({formatNumber(entry.count)})
              </option>
            ))}
          </select>
        </div>
        {filtered ? (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setLevels([]);
              setSource("");
              setSearchText("");
            }}
          >
            {t("logs.clear")}
          </Button>
        ) : null}
      </div>

      <Card className="min-h-0 flex-1 gap-0 py-0">
        <CardTitleRow icon="list" title={t("logs.list")}>
          {feed.entries.length > 0 ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("logs.shown", { count: formatNumber(feed.entries.length) })}
            </span>
          ) : null}
        </CardTitleRow>

        {loading && feed.entries.length === 0 && !feed.error ? (
          <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t("logs.loading")}
          </div>
        ) : (
          <div
            className={cx(
              "relative min-h-0 flex-1 overflow-auto px-3 pb-2 transition-opacity sm:px-5",
              loading && "opacity-60",
            )}
          >
            {/* Fixed columns, so a long message wraps inside its own instead of widening the table. */}
            <Table className="min-w-full table-fixed" containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{t("logs.col.time")}</TableHead>
                  <TableHead className="w-32">{t("logs.col.level")}</TableHead>
                  <TableHead className="hidden w-60 md:table-cell">{t("logs.col.source")}</TableHead>
                  <TableHead>{t("logs.col.message")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feed.entries.map((entry) => (
                  <LogRow
                    key={entry.sequence}
                    entry={entry}
                    open={opened.has(entry.sequence)}
                    onToggle={() => toggleOpened(entry.sequence)}
                  />
                ))}
                {feed.entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
                      {t("logs.empty")}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>

            <div ref={sentinel} className="flex min-h-12 items-center justify-center py-3 text-sm text-muted-foreground">
              {hasMore ? (
                <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>
                  {loadingMore ? <Spinner /> : null}
                  {loadingMore ? t("logs.loadingMore") : t("logs.more")}
                </Button>
              ) : feed.entries.length > 0 && feed.summary ? (
                <p>{t("logs.end", { capacity: formatNumber(feed.summary.capacity) })}</p>
              ) : null}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
