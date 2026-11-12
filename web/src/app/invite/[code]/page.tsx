"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

import { ErrorNotice } from "@/components/primitives/ErrorNotice";
import { rememberPendingInvite } from "@/lib/invites";
import { useLanguage, usePorts, useSession } from "@/state/hooks";

import { AppSkeleton } from "../../AppSkeleton";

export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const ports = usePorts();
  const { phase, reload } = useSession();
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (phase === "anonymous") {
      // Registering comes first; the redirect after it brings the visitor back.
      rememberPendingInvite(code);
      router.replace("/register");
      return;
    }
    if (phase !== "ready") return;

    let active = true;
    ports.directory.joinInvite(code).then(
      (server) => {
        if (!active) return;
        ports.directory.selectServer(server.id);
        router.replace("/");
        reload();
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [code, phase, ports, reload, router]);

  if (!failed) return <AppSkeleton />;

  return (
    <main style={{ height: "100%", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "min(420px, 100%)" }}>
        <ErrorNotice
          title={t("shell.inviteInvalid")}
          message={t("shell.inviteInvalidDetail")}
          icon="link"
          actions={[{ label: t("common.close"), onClick: () => router.replace("/") }]}
        />
      </div>
    </main>
  );
}
