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

export type CockpitServiceId = "api" | "database" | "realtime" | "maintenance" | "storage";

export interface CockpitRuntimeService {
  name: string;
  state: "healthy" | "warning" | "error" | "inactive";
  detail: string;
  /** Which service it is; its availability is drawn from the samples by this. */
  id: CockpitServiceId;
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
  /** Whether the object store answered its check; null when it is not checked. */
  storageUp: boolean | null;
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

export type CockpitBackupPart = "database" | "objects" | "keys" | "instance";

export interface CockpitBackup {
  id: string;
  sizeBytes: number;
  createdAt: string;
  verifiedAt: string | null;
  /** What the backup holds; a plain `.db` file holds the database alone. */
  parts: CockpitBackupPart[];
  /** Objects the store could not give when the backup was made. */
  missingObjects: number;
}

/** A backup being written in the background. */
export interface CockpitBackupJob {
  id: string;
  parts: CockpitBackupPart[];
  startedAt: string;
  phase: CockpitBackupPart;
  objectsDone: number;
  objectsTotal: number;
}

export interface CockpitBackups {
  backups: CockpitBackup[];
  retentionDays: number;
  job: CockpitBackupJob | null;
  /** Why the last backup did not finish; cleared by the next one that does. */
  lastFailure: { id: string; message: string; at: string } | null;
}

export type CockpitBackupChoice = Record<CockpitBackupPart, boolean>;

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

/** An integration switch the operator flipped; one left out stays as stored. */
export type CockpitIntegrationSwitches = Partial<Pick<CockpitSettings, "resendEnabled" | "giphyEnabled">>;

export type CockpitSecurityKey =
  | "mfaRequirement"
  | "trustedDeviceDays"
  | "authChallengeMinutes"
  | "emailCodeMinutes"
  | "emailCodeCooldownSeconds"
  | "emailCodeMaxAttempts"
  | "emailCodeSendsPerHour"
  | "cliRecoveryMinutes";

/** A sign-in security setting the operator changed; one left out stays as stored. */
export type CockpitSecurityChanges = Partial<Pick<CockpitSettings, CockpitSecurityKey>>;

export type CockpitSmtpSecurity = "starttls" | "tls" | "none";

/**
 * Who has to confirm sign-in with a second factor. Anything but `optional`
 * also lets only a session confirmed with an actual second factor into
 * Cockpit; a trusted device is not enough there.
 */
export type CockpitMfaRequirement = "optional" | "admins" | "everyone" | "cockpit";

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
  mfaRequirement: CockpitMfaRequirement;
  /** How long a device remembered at sign-in skips the second factor. */
  trustedDeviceDays: number;
  /** How long a sign-in waits for its second factor. */
  authChallengeMinutes: number;
  emailCodeMinutes: number;
  /** The wait before another email code can be sent; 0 means none. */
  emailCodeCooldownSeconds: number;
  /** Wrong entries one email code allows. */
  emailCodeMaxAttempts: number;
  emailCodeSendsPerHour: number;
  /** How long a recovery credential printed by the operator CLI works. */
  cliRecoveryMinutes: number;
}

interface ProblemDetails {
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
  /** The reason in a form code can test, which some refusals carry next to their text. */
  code?: unknown;
}

export class CockpitApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: Record<string, string[]> = {},
    /** The problem's `code` when the server names the reason, null otherwise. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "CockpitApiError";
  }
}

/** The code of a 403 that refuses the owner only because the session has not completed a second step. */
export const COCKPIT_MFA_REQUIRED = "cockpit-mfa-required";

/**
 * What a sign-in answers instead of a user when the password is not enough:
 * a second step, a first method to set up, or an account recovery. The web
 * client's sign-in page finishes all three.
 */
export type CockpitLoginStep = "mfa_required" | "mfa_enrollment_required" | "security_recovery_required";

const LOGIN_STEPS: readonly CockpitLoginStep[] = [
  "mfa_required",
  "mfa_enrollment_required",
  "security_recovery_required",
];

/** The step a sign-in answer still asks for, or null when the answer is the signed-in user. */
export function pendingLoginStep(answer: unknown): CockpitLoginStep | null {
  if (typeof answer !== "object" || answer === null || !("status" in answer)) return null;
  const { status } = answer;
  return LOGIN_STEPS.find((step) => step === status) ?? null;
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
      typeof problem.code === "string" ? problem.code : null,
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
  /**
   * The database alone comes back at once as a plain SQLite file; anything
   * more starts an archive in the background and comes back as its job.
   */
  createBackup: (choice: CockpitBackupChoice, signal?: AbortSignal) =>
    request<CockpitBackup | CockpitBackupJob>("/api/cockpit/backups", { method: "POST", body: choice }, signal),
  verifyBackup: (backupId: string, signal?: AbortSignal) =>
    request<CockpitBackup>(`/api/cockpit/backups/${segment(backupId)}/verify`, { method: "POST" }, signal),
  backupDownloadUrl: (backupId: string) => `/api/cockpit/backups/${segment(backupId)}/download`,

  settings: (signal?: AbortSignal) => request<CockpitSettings>("/api/cockpit/settings", {}, signal),
  // The server owns publicUrl (it comes from the environment), mailProvider,
  // resendApiKeyConfigured, smtpPasswordConfigured, mailReady, giphyKeyConfigured and updatedAt,
  // so they are never sent back.
  // The integration switches go only when the operator flips one. The settings
  // carry their effective state, and sending that back would turn "never
  // chosen" (on as soon as a key exists) into an explicit "off".
  // The sign-in security settings go only when the operator changed one, so a
  // save of the other settings leaves them as they are stored.
  updateSettings: (
    settings: CockpitSettings,
    changes: CockpitIntegrationSwitches & CockpitSecurityChanges = {},
    signal?: AbortSignal,
  ) =>
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
          ...changes,
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
  /** Resolves to null once signed in, or to the step the web client's sign-in page has to finish. */
  /** `keepSignedIn` false asks for a session that ends with the browser. */
  login: async (username: string, password: string, keepSignedIn = true, signal?: AbortSignal) =>
    pendingLoginStep(
      await request<unknown>(
        "/api/auth/login",
        { method: "POST", body: { username, password, ...(keepSignedIn ? {} : { keepSignedIn: false }) } },
        signal,
      ),
    ),
  logout: (signal?: AbortSignal) => request<void>("/api/auth/logout", { method: "POST" }, signal),
};
