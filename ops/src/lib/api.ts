import { t } from "@/i18n";

export interface OpsOperator {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface OpsInstance {
  id: string;
  name: string;
  createdAt: string;
}

export interface OpsOverview {
  userCount: number;
  onlineUserCount: number;
  realtimeConnectionCount: number;
  storedObjectBytes: number;
  messageCount: number;
}

/** One day of activity on the instance server; `date` is the instance's local date (YYYY-MM-DD). */
export interface OpsActivityDay {
  date: string;
  messages: number;
  newMembers: number;
}

/** The last 30 days, oldest first and today last, counted in `timeZone`. */
export interface OpsActivity {
  timeZone: string;
  days: OpsActivityDay[];
}

export interface OpsBootstrap {
  operator: OpsOperator;
  instance: OpsInstance;
  overview: OpsOverview;
}

export interface OpsUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  avatarColor: string;
  avatarUrl: string | null;
  presence: "online" | "idle" | "dnd" | "offline";
  realtimeConnections: number;
  roleId: string;
  roleName: string;
  isDisabled: boolean;
  joinedAt: string;
  createdAt: string;
}

export interface OpsRole {
  id: string;
  name: string;
  color: string;
  permissions: string[];
  memberCount: number;
  isSystem: boolean;
  isOwner: boolean;
}

export interface OpsUsers {
  users: OpsUser[];
  roles: OpsRole[];
  sessionRegistryAvailable: boolean;
}

export interface OpsSession {
  id: string;
  userId: string;
  userDisplayName: string;
  device: string;
  clientName: string | null;
  clientVersion: string | null;
  clientRuntime: string | null;
  installType: string | null;
  ipAddress: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface OpsRuntimeService {
  name: string;
  state: "healthy" | "warning" | "error" | "inactive";
  detail: string;
}

export interface OpsRuntime {
  startedAt: string;
  uptimeSeconds: number;
  workingSetBytes: number;
  gcHeapBytes: number;
  threadCount: number;
  realtimeConnections: number;
  voiceRooms: number;
  databaseLatencyMs: number;
  services: OpsRuntimeService[];
}

export interface OpsLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  traceId: string;
}

export interface OpsAuditEntry {
  id: string;
  actor: string;
  summary: string;
  at: string;
}

export interface OpsLogs {
  logs: OpsLogEntry[];
  audit: OpsAuditEntry[];
}

export interface OpsBackup {
  id: string;
  sizeBytes: number;
  createdAt: string;
  verifiedAt: string | null;
}

export interface OpsBackups {
  backups: OpsBackup[];
  retentionDays: number;
}

export interface OpsSettings {
  instanceName: string;
  publicUrl: string;
  timeZone: string;
  mailingEnabled: boolean;
  mailProvider: "resend";
  mailFromAddress: string;
  resendApiKeyConfigured: boolean;
  inviteMailEnabled: boolean;
  recoveryMailEnabled: boolean;
  alertMailEnabled: boolean;
  backupRetentionDays: number;
  logRetentionDays: number;
  orphanObjectRetentionDays: number;
  automaticCleanupEnabled: boolean;
  updatedAt: string;
}

interface ProblemDetails {
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}

export class OpsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "OpsApiError";
  }
}

/**
 * The API signs in only clients it recognises (`ClientGate` on the server),
 * and the panel is one of them. Without these headers the panel's own sign-in
 * is refused as an unsupported app.
 */
export const CLIENT_KIND = "ops";
/** Kept in step with `package.json`; the server parses it as a version. */
export const CLIENT_VERSION = "0.1.0";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  try {
    return ((await response.json()) as ProblemDetails | null) ?? {};
  } catch {
    // An empty or non-JSON error body still has the HTTP status to report.
    return {};
  }
}

async function request<T>(
  path: string,
  { method = "GET", body }: RequestOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const hasBody = body !== undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-Stellarr-Client": CLIENT_KIND,
        "X-Stellarr-Client-Version": CLIENT_VERSION,
        ...(hasBody && { "Content-Type": "application/json" }),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new OpsApiError(0, t("api.unreachable"));
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    throw new OpsApiError(
      response.status,
      problem.detail ?? problem.title ?? t("api.status", { status: response.status }),
      problem.errors ?? {},
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const segment = encodeURIComponent;

export const opsApi = {
  bootstrap: (signal?: AbortSignal) => request<OpsBootstrap>("/api/ops/bootstrap", {}, signal),
  activity: (signal?: AbortSignal) => request<OpsActivity>("/api/ops/activity", {}, signal),

  users: (signal?: AbortSignal) => request<OpsUsers>("/api/ops/users", {}, signal),
  createUser: (
    input: { username: string; displayName: string; email?: string; password: string; roleId: string },
    signal?: AbortSignal,
  ) => request<{ id: string }>("/api/ops/users", { method: "POST", body: input }, signal),
  setUserRole: (userId: string, roleId: string, signal?: AbortSignal) =>
    request<void>(`/api/ops/users/${segment(userId)}/role`, { method: "PATCH", body: { roleId } }, signal),
  setUserDisabled: (userId: string, disabled: boolean, signal?: AbortSignal) =>
    request<void>(`/api/ops/users/${segment(userId)}/status`, { method: "PATCH", body: { disabled } }, signal),

  createRole: (input: { name: string; color: string; permissions: string[] }, signal?: AbortSignal) =>
    request<OpsRole>("/api/ops/roles", { method: "POST", body: input }, signal),
  updateRole: (
    roleId: string,
    input: { name: string; color: string; permissions: string[] },
    signal?: AbortSignal,
  ) => request<OpsRole>(`/api/ops/roles/${segment(roleId)}`, { method: "PATCH", body: input }, signal),

  sessions: (signal?: AbortSignal) => request<OpsSession[]>("/api/ops/sessions", {}, signal),
  revokeSession: (sessionId: string, signal?: AbortSignal) =>
    request<void>(`/api/ops/sessions/${segment(sessionId)}`, { method: "DELETE" }, signal),

  runtime: (signal?: AbortSignal) => request<OpsRuntime>("/api/ops/runtime", {}, signal),

  logs: (signal?: AbortSignal) => request<OpsLogs>("/api/ops/logs", {}, signal),
  logExportUrl: "/api/ops/logs/export",

  backups: (signal?: AbortSignal) => request<OpsBackups>("/api/ops/backups", {}, signal),
  createBackup: (signal?: AbortSignal) =>
    request<OpsBackup>("/api/ops/backups", { method: "POST" }, signal),
  verifyBackup: (backupId: string, signal?: AbortSignal) =>
    request<OpsBackup>(`/api/ops/backups/${segment(backupId)}/verify`, { method: "POST" }, signal),
  backupDownloadUrl: (backupId: string) => `/api/ops/backups/${segment(backupId)}/download`,

  settings: (signal?: AbortSignal) => request<OpsSettings>("/api/ops/settings", {}, signal),
  // The server owns mailProvider, resendApiKeyConfigured and updatedAt, so they are never sent back.
  updateSettings: (settings: OpsSettings, signal?: AbortSignal) =>
    request<OpsSettings>(
      "/api/ops/settings",
      {
        method: "PUT",
        body: {
          instanceName: settings.instanceName,
          publicUrl: settings.publicUrl,
          timeZone: settings.timeZone,
          mailingEnabled: settings.mailingEnabled,
          mailFromAddress: settings.mailFromAddress,
          inviteMailEnabled: settings.inviteMailEnabled,
          recoveryMailEnabled: settings.recoveryMailEnabled,
          alertMailEnabled: settings.alertMailEnabled,
          backupRetentionDays: settings.backupRetentionDays,
          logRetentionDays: settings.logRetentionDays,
          orphanObjectRetentionDays: settings.orphanObjectRetentionDays,
          automaticCleanupEnabled: settings.automaticCleanupEnabled,
        },
      },
      signal,
    ),
  sendTestMail: (to: string, signal?: AbortSignal) =>
    request<{ id: string }>("/api/ops/mail/test", { method: "POST", body: { to } }, signal),


  requestPasswordReset: (email: string, signal?: AbortSignal) =>
    request<void>("/api/auth/password/forgot", { method: "POST", body: { email } }, signal),
  login: (username: string, password: string, signal?: AbortSignal) =>
    request<unknown>("/api/auth/login", { method: "POST", body: { username, password } }, signal),
  logout: (signal?: AbortSignal) => request<void>("/api/auth/logout", { method: "POST" }, signal),
};
