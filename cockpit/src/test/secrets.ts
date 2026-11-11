import type { CockpitSecret, CockpitSecretName } from "@/lib/api";

const VARIABLES: Record<CockpitSecretName, string> = {
  "mail.resend-api-key": "STELLARR_RESEND_API_KEY",
  "mail.smtp-password": "STELLARR_SMTP_PASSWORD",
  "giphy.api-key": "GIPHY_API_KEY",
};

/** The state of one secret as the server reports it. */
export function secret(name: CockpitSecretName, source: CockpitSecret["source"] = "none"): CockpitSecret {
  return {
    name,
    configured: source !== "none",
    source,
    variable: VARIABLES[name],
    updatedAt: source === "panel" ? "2026-11-11T12:00:00Z" : null,
  };
}

/** Every secret, each from the given source unless named otherwise. */
export function secrets(sources: Partial<Record<CockpitSecretName, CockpitSecret["source"]>> = {}): CockpitSecret[] {
  return (Object.keys(VARIABLES) as CockpitSecretName[]).map((name) => secret(name, sources[name]));
}
