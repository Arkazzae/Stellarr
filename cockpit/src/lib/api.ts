import { t } from "@/i18n";

export interface CockpitOperator {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CockpitInstance {
  id: string;
  name: string;
  createdAt: string;
}

export interface CockpitOverview {
  userCount: number;
  onlineUserCount: number;
  realtimeConnectionCount: number;
  storedObjectBytes: number;
  messageCount: number;
}

/** One day of activity on the instance server; `date` is the instance's local date (YYYY-MM-DD). */
export interface CockpitActivityDay {
  date: string;
  messages: number;
  newMembers: number;
}

/** The last 30 days, oldest first and today last, counted in `timeZone`. */
export interface CockpitActivity {
  timeZone: string;
  days: CockpitActivityDay[];
}

export interface CockpitBootstrap {
  operator: CockpitOperator;
  instance: CockpitInstance;
  overview: CockpitOverview;
}

export interface CockpitUser {
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

export interface CockpitRole {
  id: string;
  name: string;
  color: string;
  permissions: string[];
  memberCount: number;
  isSystem: boolean;
  isOwner: boolean;
}

export interface CockpitUsers {
  users: CockpitUser[];
  roles: CockpitRole[];
  sessionRegistryAvailable: boolean;
}

export interface CockpitSession {
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

export interface CockpitServerPerson {
  id: string;
  username: string;
  displayName: string;
}

/** A server of the instance; `isInstance` marks the one the operator owns, which Cockpit never deletes or hands over. */
export interface CockpitServer {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  createdAt: string;
  isInstance: boolean;
  owner: CockpitServerPerson | null;
  memberCount: number;
  channelCount: number;
}

export interface CockpitServerMember extends CockpitServerPerson {
  isOwner: boolean;
}

export interface CockpitRuntimeService {
  name: string;
  state: "healthy" | "warning" | "error" | "inactive";
  detail: string;
}

/** One sampling interval of the API process; request counts are for that interval alone. */
export interface CockpitRuntimeSample {
  at: string;
  workingSetBytes: number;
  gcHeapBytes: number;
  threads: number;
  cpuPercent: number;
  realtimeConnections: number;
  requests: number;
  clientErrors: number;
  serverErrors: number;
}

export interface CockpitRuntime {
  startedAt: string;
  uptimeSeconds: number;
  workingSetBytes: number;
  gcHeapBytes: number;
  threadCount: number;
  realtimeConnections: number;
  voiceRooms: number;
  databaseLatencyMs: number;
  services: CockpitRuntimeService[];
  cpuPercent: number;
  sampleSeconds: number;
  /** The last hour, oldest first. */
  history: CockpitRuntimeSample[];
}

export interface CockpitLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  traceId: string;
}

export interface CockpitAuditEntry {
  id: string;
  actor: string;
  summary: string;
  at: string;
}

export interface CockpitLogs {
  logs: CockpitLogEntry[];
  audit: CockpitAuditEntry[];
}

export interface CockpitBackup {
  id: string;
  sizeBytes: number;
  createdAt: string;
  verifiedAt: string | null;
}

export interface CockpitBackups {
  backups: CockpitBackup[];
  retentionDays: number;
}

export interface CockpitSettings {
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

export class CockpitApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "CockpitApiError";
  }
}

/**
 * The API signs in only clients it recognises (`ClientGate` on the server),
 * and the panel is one of them. Without these headers the panel's own sign-in
 * is refused as an unsupported app.
 */
export const CLIENT_KIND = "cockpit";
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
    throw new CockpitApiError(0, t("api.unreachable"));
  }

  if (!response.ok) {
    const problem = await readProblem(response);
    throw new CockpitApiError(
      response.status,
      problem.detail ?? problem.title ?? t("api.status", { status: response.status }),
      problem.errors ?? {},
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const segment = encodeURIComponent;

export const cockpitApi = {
  bootstrap: (signal?: AbortSignal) => request<CockpitBootstrap>("/api/cockpit/bootstrap", {}, signal),
  activity: (signal?: AbortSignal) => request<CockpitActivity>("/api/cockpit/activity", {}, signal),

  users: (signal?: AbortSignal) => request<CockpitUsers>("/api/cockpit/users", {}, signal),
  createUser: (
    input: { username: string; displayName: string; email?: string; password: string; roleId: string },
    signal?: AbortSignal,
  ) => request<{ id: string }>("/api/cockpit/users", { method: "POST", body: input }, signal),
  setUserRole: (userId: string, roleId: string, signal?: AbortSignal) =>
    request<void>(`/api/cockpit/users/${segment(userId)}/role`, { method: "PATCH", body: { roleId } }, signal),
  setUserDisabled: (userId: string, disabled: boolean, signal?: AbortSignal) =>
    request<void>(`/api/cockpit/users/${segment(userId)}/status`, { method: "PATCH", body: { disabled } }, signal),

  createRole: (input: { name: string; color: string; permissions: string[] }, signal?: AbortSignal) =>
    request<CockpitRole>("/api/cockpit/roles", { method: "POST", body: input }, signal),
  updateRole: (
    roleId: string,
    input: { name: string; color: string; permissions: string[] },
    signal?: AbortSignal,
  ) => request<CockpitRole>(`/api/cockpit/roles/${segment(roleId)}`, { method: "PATCH", body: input }, signal),

  servers: (signal?: AbortSignal) => request<CockpitServer[]>("/api/cockpit/servers", {}, signal),
  serverMembers: (serverId: string, signal?: AbortSignal) =>
    request<CockpitServerMember[]>(`/api/cockpit/servers/${segment(serverId)}/members`, {}, signal),
  transferServer: (serverId: string, userId: string, signal?: AbortSignal) =>
    request<void>(`/api/cockpit/servers/${segment(serverId)}/transfer`, { method: "POST", body: { userId } }, signal),
  deleteServer: (serverId: string, signal?: AbortSignal) =>
    request<void>(`/api/cockpit/servers/${segment(serverId)}`, { method: "DELETE" }, signal),
  sessions: (signal?: AbortSignal) => request<CockpitSession[]>("/api/cockpit/sessions", {}, signal),
  revokeSession: (sessionId: string, signal?: AbortSignal) =>
    request<void>(`/api/cockpit/sessions/${segment(sessionId)}`, { method: "DELETE" }, signal),

  runtime: (signal?: AbortSignal) => request<CockpitRuntime>("/api/cockpit/runtime", {}, signal),

  logs: (signal?: AbortSignal) => request<CockpitLogs>("/api/cockpit/logs", {}, signal),
  logExportUrl: "/api/cockpit/logs/export",

  backups: (signal?: AbortSignal) => request<CockpitBackups>("/api/cockpit/backups", {}, signal),
  createBackup: (signal?: AbortSignal) =>
    request<CockpitBackup>("/api/cockpit/backups", { method: "POST" }, signal),
  verifyBackup: (backupId: string, signal?: AbortSignal) =>
    request<CockpitBackup>(`/api/cockpit/backups/${segment(backupId)}/verify`, { method: "POST" }, signal),
  backupDownloadUrl: (backupId: string) => `/api/cockpit/backups/${segment(backupId)}/download`,

  settings: (signal?: AbortSignal) => request<CockpitSettings>("/api/cockpit/settings", {}, signal),
  // The server owns mailProvider, resendApiKeyConfigured and updatedAt, so they are never sent back.
  updateSettings: (settings: CockpitSettings, signal?: AbortSignal) =>
    request<CockpitSettings>(
      "/api/cockpit/settings",
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
    request<{ id: string }>("/api/cockpit/mail/test", { method: "POST", body: { to } }, signal),


  requestPasswordReset: (email: string, signal?: AbortSignal) =>
    request<void>("/api/auth/password/forgot", { method: "POST", body: { email } }, signal),
  login: (username: string, password: string, signal?: AbortSignal) =>
    request<unknown>("/api/auth/login", { method: "POST", body: { username, password } }, signal),
  logout: (signal?: AbortSignal) => request<void>("/api/auth/logout", { method: "POST" }, signal),
};
