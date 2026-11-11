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
  /** Every server on the instance, the instance's own included. */
  serverCount: number;
  publicServerCount: number;
}

/**
 * One day of activity; `date` is the instance's local date (YYYY-MM-DD).
 * Messages, active users, new members and reactions are the instance server's;
 * uploads and sign-ins are the whole instance's.
 */
export interface CockpitActivityDay {
  date: string;
  messages: number;
  newMembers: number;
  /** Different people who wrote that day. */
  activeUsers: number;
  reactions: number;
  uploads: number;
  signIns: number;
}

/** The last 30 days, oldest first and today last, counted in `timeZone`. */
export interface CockpitActivity {
  timeZone: string;
  days: CockpitActivityDay[];
  /** Different people who wrote in the whole window; the days do not add up to it. */
  activeUsers: number;
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
  /** Whether the database answered the check taken with this sample, and how fast. */
  databaseUp: boolean;
  databaseLatencyMs: number;
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

export type CockpitLogLevel = "info" | "warn" | "error";

export interface CockpitLogEntry {
  /** The line's place in everything the process has logged; the paging cursor. */
  sequence: number;
  at: string;
  level: CockpitLogLevel;
  source: string;
  message: string;
  traceId: string;
}

/** A page of log lines, newest first. */
export interface CockpitLogs {
  entries: CockpitLogEntry[];
  /** Asks for the next, older page; null when no older line matches. */
  nextBefore: number | null;
  /** Lines of each level that match the source and the search, whatever level is chosen. */
  levels: Record<CockpitLogLevel, number>;
  /** Sources in the buffer, the busiest first. */
  sources: { name: string; count: number }[];
  /** How many lines the server keeps. */
  capacity: number;
}

export interface CockpitLogFilters {
  levels: CockpitLogLevel[];
  source: string;
  search: string;
}

/** The filters as a query string, empty ones left out. */
function logQuery(filters: CockpitLogFilters, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams(extra);
  if (filters.levels.length > 0) query.set("level", filters.levels.join(","));
  if (filters.source) query.set("source", filters.source);
  if (filters.search.trim()) query.set("search", filters.search.trim());
  const text = query.toString();
  return text ? `?${text}` : "";
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

export type CockpitSecretName = "mail.resend-api-key" | "mail.smtp-password" | "giphy.api-key";

/**
 * Whether a secret is set and where from. The value never comes back: the
 * panel can set, replace or remove a secret, not read it. `variable` is the
 * name an operator would set in `.env` instead.
 */
export interface CockpitSecret {
  name: CockpitSecretName;
  configured: boolean;
  source: "panel" | "environment" | "none";
  variable: string;
  /** When the panel's value was set; null for any other source. */
  updatedAt: string | null;
}

export type CockpitSmtpSecurity = "starttls" | "tls" | "none";

export interface CockpitSettings {
  instanceName: string;
  publicUrl: string;
  timeZone: string;
  mailingEnabled: boolean;
  /** The transport mail goes through: SMTP, or Resend when it is turned on under Integrations. */
  mailProvider: "smtp" | "resend";
  mailFromAddress: string;
  resendApiKeyConfigured: boolean;
  resendEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: CockpitSmtpSecurity;
  smtpUsername: string;
  /** Whether Mail__SmtpPassword is set; the password itself never leaves the server. */
  smtpPasswordConfigured: boolean;
  /** Whether the chosen transport has what it needs to send. */
  mailReady: boolean;
  /** Whether the web client offers GIFs: switched on and with a key. */
  giphyEnabled: boolean;
  giphyKeyConfigured: boolean;
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

  logs: (filters: CockpitLogFilters, before: number | null, signal?: AbortSignal) =>
    request<CockpitLogs>(
      `/api/cockpit/logs${logQuery(filters, before === null ? {} : { before: String(before) })}`,
      {},
      signal,
    ),
  logExportUrl: (filters: CockpitLogFilters) => `/api/cockpit/logs/export${logQuery(filters)}`,

  backups: (signal?: AbortSignal) => request<CockpitBackups>("/api/cockpit/backups", {}, signal),
  createBackup: (signal?: AbortSignal) =>
    request<CockpitBackup>("/api/cockpit/backups", { method: "POST" }, signal),
  verifyBackup: (backupId: string, signal?: AbortSignal) =>
    request<CockpitBackup>(`/api/cockpit/backups/${segment(backupId)}/verify`, { method: "POST" }, signal),
  backupDownloadUrl: (backupId: string) => `/api/cockpit/backups/${segment(backupId)}/download`,

  settings: (signal?: AbortSignal) => request<CockpitSettings>("/api/cockpit/settings", {}, signal),
  // The server owns publicUrl (it comes from the environment), mailProvider,
  // resendApiKeyConfigured, smtpPasswordConfigured, mailReady, giphyKeyConfigured and updatedAt,
  // so they are never sent back.
  updateSettings: (settings: CockpitSettings, signal?: AbortSignal) =>
    request<CockpitSettings>(
      "/api/cockpit/settings",
      {
        method: "PUT",
        body: {
          instanceName: settings.instanceName,
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
          smtpHost: settings.smtpHost,
          smtpPort: settings.smtpPort,
          smtpSecurity: settings.smtpSecurity,
          smtpUsername: settings.smtpUsername,
          resendEnabled: settings.resendEnabled,
          giphyEnabled: settings.giphyEnabled,
        },
      },
      signal,
    ),
  /** Tries the GIPHY key with one request to GIPHY. */
  testGiphy: (signal?: AbortSignal) =>
    request<{ connected: boolean }>("/api/cockpit/integrations/giphy/test", { method: "POST" }, signal),
  secrets: (signal?: AbortSignal) => request<CockpitSecret[]>("/api/cockpit/secrets", {}, signal),
  setSecret: (name: CockpitSecretName, value: string, signal?: AbortSignal) =>
    request<CockpitSecret>(`/api/cockpit/secrets/${segment(name)}`, { method: "PUT", body: { value } }, signal),
  clearSecret: (name: CockpitSecretName, signal?: AbortSignal) =>
    request<CockpitSecret>(`/api/cockpit/secrets/${segment(name)}`, { method: "DELETE" }, signal),
  sendTestMail: (to: string, signal?: AbortSignal) =>
    request<{ id: string; provider: CockpitSettings["mailProvider"] }>("/api/cockpit/mail/test", { method: "POST", body: { to } }, signal),


  requestPasswordReset: (email: string, signal?: AbortSignal) =>
    request<void>("/api/auth/password/forgot", { method: "POST", body: { email } }, signal),
  login: (username: string, password: string, signal?: AbortSignal) =>
    request<unknown>("/api/auth/login", { method: "POST", body: { username, password } }, signal),
  logout: (signal?: AbortSignal) => request<void>("/api/auth/logout", { method: "POST" }, signal),
};
