import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type MessageKey } from "@/i18n";
import { formatDate } from "@/i18n/format";
import {
  OpsApiError,
  opsApi,
  type OpsDesktopRelease,
  type OpsPublishedClientRelease,
} from "@/lib/api";
import { useOpsResource } from "@/lib/use-ops-resource";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const platforms = {
  android: {
    title: "Android",
    architecture: "ARM64",
    downloadKey: "release.downloadApk",
  },
  arch: {
    title: "Arch Linux",
    architecture: "x86_64",
    downloadKey: "release.downloadPackage",
  },
} satisfies Record<
  string,
  { title: string; architecture: string; downloadKey: MessageKey }
>;

interface PublishedReleaseProps {
  platform: keyof typeof platforms;
  release: OpsPublishedClientRelease | null;
}

function PublishedRelease({ platform, release }: PublishedReleaseProps) {
  const { title, architecture, downloadKey } = platforms[platform];

  return (
    <div className="border-t py-5 first:border-t-0 first:pt-0 last:pb-0">
      {release ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {title} <span className="text-muted-foreground">v{release.version}</span>
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground" title={release.fileName}>
                {release.fileName}
              </p>
              <p className="text-xs text-muted-foreground">
                {architecture} · {formatSize(release.sizeBytes)}
              </p>
              <p className="text-xs text-muted-foreground">{formatDate(release.publishedAt)}</p>
            </div>
            <Button asChild>
              <a href={release.downloadUrl} download={release.fileName}>
                {t(downloadKey)}
              </a>
            </Button>
          </div>
          {release.notes ? <p className="text-sm text-muted-foreground">{release.notes}</p> : null}
          <div className="grid gap-1">
            <p className="text-sm leading-none font-medium">SHA-256</p>
            <code
              className="overflow-hidden rounded-md bg-muted px-3 py-2 font-mono text-xs text-ellipsis text-muted-foreground"
              title={release.sha256}
            >
              {release.sha256}
            </code>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {t("release.missing", { platform: title })}
        </div>
      )}
    </div>
  );
}

interface VersionFieldProps {
  id: string;
  label: string;
  value: string;
  errors: string[] | undefined;
  onChange: (value: string) => void;
}

function VersionField({ id, label, value, errors, onChange }: VersionFieldProps) {
  const error = errors?.[0];
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        placeholder="0.1.0"
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function DesktopReleaseView({ initial }: { initial: OpsDesktopRelease }) {
  const [release, setRelease] = useState(initial);
  const [minimumVersion, setMinimumVersion] = useState(initial.minimumVersion);
  const [recommendedVersion, setRecommendedVersion] = useState(initial.recommendedVersion);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setFieldErrors({});
    try {
      const value = await opsApi.updateDesktopRelease({ minimumVersion, recommendedVersion });
      setRelease(value);
      setMinimumVersion(value.minimumVersion);
      setRecommendedVersion(value.recommendedVersion);
      setSaved(true);
    } catch (cause) {
      if (cause instanceof OpsApiError) {
        setFieldErrors(cause.errors);
        setSaveError(cause.message);
      } else {
        setSaveError(t("release.saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  }

  const publishedCount = Number(Boolean(release.published)) + Number(Boolean(release.androidPublished));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("release.title")}
        description={t("release.description")}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("release.published.title")}</CardTitle>
              <CardDescription>{t("release.published.description")}</CardDescription>
            </div>
            <Badge variant={publishedCount === 2 ? "success" : "warning"}>
              {t("release.published.count", { count: publishedCount })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <PublishedRelease platform="android" release={release.androidPublished} />
          <PublishedRelease platform="arch" release={release.published} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("release.compatibility.title")}</CardTitle>
          <CardDescription>{t("release.compatibility.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={(event) => void save(event)}>
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <VersionField
                id="desktop-minimum"
                label={t("release.minimumVersion")}
                value={minimumVersion}
                errors={fieldErrors.minimumVersion}
                onChange={setMinimumVersion}
              />
              <VersionField
                id="desktop-recommended"
                label={t("release.recommendedVersion")}
                value={recommendedVersion}
                errors={fieldErrors.recommendedVersion}
                onChange={setRecommendedVersion}
              />
            </div>
            {saveError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("release.saveError")}</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            {saved ? (
              <Alert>
                <AlertTitle>{t("release.saved.title")}</AlertTitle>
                <AlertDescription>{t("release.saved.description")}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              disabled={saving || !minimumVersion.trim() || !recommendedVersion.trim()}
            >
              {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {saving ? t("release.saving") : t("release.save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function DesktopReleasePage() {
  const { data, error } = useOpsResource(opsApi.desktopRelease, t("release.loadFailed"));

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("release.loadError")}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) {
    return (
      <div
        role="status"
        className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"
      >
        <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
        {t("release.loading")}
      </div>
    );
  }
  return <DesktopReleaseView initial={data} />;
}
