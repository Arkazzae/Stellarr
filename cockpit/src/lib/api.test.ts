import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { version as PACKAGE_VERSION } from "../../package.json";
import {
  CLIENT_KIND,
  CLIENT_VERSION,
  COCKPIT_MFA_REQUIRED,
  CockpitApiError,
  cockpitApi,
  pendingLoginStep,
  type CockpitSettings,
} from "./api";
import { selectPolish } from "@/test/locale";

const fetchMock = vi.fn<typeof fetch>();

selectPolish();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The URL and options of the most recent fetch call, with the JSON body parsed. */
function sentRequest() {
  const call = fetchMock.mock.lastCall;
  if (!call) throw new Error("fetch was not called");
  const [url, init = {}] = call;
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : init.body,
  };
}

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(CockpitApiError);
  return error as CockpitApiError;
}

/** What the server's client gate needs before it lets the panel sign in. */
const CLIENT_HEADERS = { "X-Stellarr-Client": "cockpit", "X-Stellarr-Client-Version": PACKAGE_VERSION };

describe("client identity", () => {
  it("reports the version from package.json", () => {
    expect(CLIENT_KIND).toBe("cockpit");
    expect(CLIENT_VERSION).toBe(PACKAGE_VERSION);
  });
});

describe("request basics", () => {
  it("sends a plain JSON GET with same-origin credentials and returns the parsed body", async () => {
    const bootstrap = { operator: { id: "u1" } };
    fetchMock.mockResolvedValueOnce(jsonResponse(bootstrap));

    await expect(cockpitApi.bootstrap()).resolves.toEqual(bootstrap);

    const { url, init, headers, body } = sentRequest();
    expect(url).toBe("/api/cockpit/bootstrap");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
    expect(headers).toEqual({ Accept: "application/json", ...CLIENT_HEADERS });
    expect(body).toBeUndefined();
  });

  it("sends a JSON content type only together with a body", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));

    await cockpitApi.verifyBackup("b1");
    expect(sentRequest().headers).toEqual({ Accept: "application/json", ...CLIENT_HEADERS });
    expect(sentRequest().body).toBeUndefined();

    await cockpitApi.login("ada", "secret");
    expect(sentRequest().headers).toEqual({
      Accept: "application/json",
      ...CLIENT_HEADERS,
      "Content-Type": "application/json",
    });
    expect(sentRequest().body).toEqual({ username: "ada", password: "secret" });
  });

  it("hands the abort signal to fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ users: [] }));
    const controller = new AbortController();

    await cockpitApi.users(controller.signal);

    expect(sentRequest().init.signal).toBe(controller.signal);
  });

  it("resolves a 204 response to undefined without reading the body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(cockpitApi.revokeSession("s1")).resolves.toBeUndefined();
  });
});

describe("failures", () => {
  it("turns a network failure into an CockpitApiError with status 0", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const error = await failureOf(cockpitApi.runtime());

    expect(error.status).toBe(0);
    expect(error.message).toBe("Nie udało się połączyć z backendem Stellarr.");
    expect(error.errors).toEqual({});
  });

  it("rethrows an aborted request untouched", async () => {
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockRejectedValueOnce(aborted);

    await expect(cockpitApi.runtime()).rejects.toBe(aborted);
  });

  it("prefers the problem detail, carries field errors and the status", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { title: "Validation failed", detail: "Nazwa jest zajęta.", errors: { name: ["zajęta"] } },
        422,
      ),
    );

    const error = await failureOf(cockpitApi.createRole({ name: "x", color: "#fff", permissions: [] }));

    expect(error.status).toBe(422);
    expect(error.message).toBe("Nazwa jest zajęta.");
    expect(error.errors).toEqual({ name: ["zajęta"] });
    expect(error.code).toBeNull();
  });

  it("keeps the code a refusal names its reason with", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ title: "Potwierdź drugi składnik.", status: 403, code: "cockpit-mfa-required" }, 403),
    );

    const error = await failureOf(cockpitApi.bootstrap());

    expect(error.status).toBe(403);
    expect(error.message).toBe("Potwierdź drugi składnik.");
    expect(error.code).toBe(COCKPIT_MFA_REQUIRED);
    expect(COCKPIT_MFA_REQUIRED).toBe("cockpit-mfa-required");
  });

  it("ignores a code that is not text", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: "Forbidden", code: 7 }, 403));

    const error = await failureOf(cockpitApi.bootstrap());

    expect(error.code).toBeNull();
  });

  it("falls back to the problem title when there is no detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: "Forbidden" }, 403));

    const error = await failureOf(cockpitApi.users());

    expect(error.status).toBe(403);
    expect(error.message).toBe("Forbidden");
  });

  it.each([
    ["an empty body", () => new Response(null, { status: 502 })],
    ["a body that is not JSON", () => new Response("<html>Bad gateway</html>", { status: 502 })],
    ["a JSON null", () => new Response("null", { status: 502 })],
    ["a problem without text", () => jsonResponse({}, 502)],
  ])("reports the status code for %s", async (_label, respond) => {
    fetchMock.mockResolvedValueOnce(respond());

    const error = await failureOf(cockpitApi.logs({ levels: [], source: "", search: "" }, null));

    expect(error.status).toBe(502);
    expect(error.message).toBe("Backend odpowiedział kodem 502.");
    expect(error.errors).toEqual({});
    expect(error.code).toBeNull();
  });
});

describe("login answers", () => {
  it.each(["mfa_required", "mfa_enrollment_required", "security_recovery_required"] as const)(
    "resolves to the pending step %s",
    async (status) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status, challengeId: "c1", methods: [] }));

      await expect(cockpitApi.login("owner", "sekret")).resolves.toBe(status);
    },
  );

  it("resolves to null when the answer is the signed-in user", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "u1", username: "owner", presence: "online", customStatus: "mfa_required" }),
    );

    await expect(cockpitApi.login("owner", "sekret")).resolves.toBeNull();
  });

  it.each([
    ["an unknown status", { status: "done" }],
    ["a status that is not text", { status: 1 }],
    ["null", null],
    ["text", "mfa_required"],
    ["nothing", undefined],
  ])("reads %s as no pending step", (_label, answer) => {
    expect(pendingLoginStep(answer)).toBeNull();
  });
});

describe("routes", () => {
  const settings: CockpitSettings = {
    instanceName: "Stellarr",
    publicUrl: "https://chat.example",
    timeZone: "Europe/Warsaw",
    mailingEnabled: true,
    mailProvider: "resend",
    mailFromAddress: "cockpit@example.com",
    resendApiKeyConfigured: true,
    resendEnabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    smtpUsername: "cockpit",
    smtpPasswordConfigured: false,
    mailReady: true,
    giphyEnabled: true,
    giphyKeyConfigured: true,
    inviteMailEnabled: true,
    recoveryMailEnabled: false,
    alertMailEnabled: true,
    backupRetentionDays: 14,
    logRetentionDays: 30,
    orphanObjectRetentionDays: 7,
    automaticCleanupEnabled: false,
    updatedAt: "2026-01-01T00:00:00Z",
    mfaRequirement: "admins",
    trustedDeviceDays: 30,
    authChallengeMinutes: 10,
    emailCodeMinutes: 15,
    emailCodeCooldownSeconds: 0,
    emailCodeMaxAttempts: 3,
    emailCodeSendsPerHour: 6,
    cliRecoveryMinutes: 20,
  };
  const role = { name: "Mod", color: "#ff0000", permissions: ["messages.delete"] };

  it.each([
    ["bootstrap", () => cockpitApi.bootstrap(), "GET", "/api/cockpit/bootstrap", undefined],
    ["activity", () => cockpitApi.activity(), "GET", "/api/cockpit/activity", undefined],
    ["servers", () => cockpitApi.servers(), "GET", "/api/cockpit/servers", undefined],
    ["serverMembers", () => cockpitApi.serverMembers("s/1"), "GET", "/api/cockpit/servers/s%2F1/members", undefined],
    [
      "transferServer",
      () => cockpitApi.transferServer("s1", "u2"),
      "POST",
      "/api/cockpit/servers/s1/transfer",
      { userId: "u2" },
    ],
    ["deleteServer", () => cockpitApi.deleteServer("s1"), "DELETE", "/api/cockpit/servers/s1", undefined],
    ["users", () => cockpitApi.users(), "GET", "/api/cockpit/users", undefined],
    [
      "createUser",
      () => cockpitApi.createUser({ username: "ada", displayName: "Ada", password: "pw", roleId: "r1" }),
      "POST",
      "/api/cockpit/users",
      { username: "ada", displayName: "Ada", password: "pw", roleId: "r1" },
    ],
    ["setUserRole", () => cockpitApi.setUserRole("u1", "r2"), "PATCH", "/api/cockpit/users/u1/role", { roleId: "r2" }],
    [
      "setUserDisabled",
      () => cockpitApi.setUserDisabled("u1", true),
      "PATCH",
      "/api/cockpit/users/u1/status",
      { disabled: true },
    ],
    ["createRole", () => cockpitApi.createRole(role), "POST", "/api/cockpit/roles", role],
    ["updateRole", () => cockpitApi.updateRole("r1", role), "PATCH", "/api/cockpit/roles/r1", role],
    ["sessions", () => cockpitApi.sessions(), "GET", "/api/cockpit/sessions", undefined],
    ["revokeSession", () => cockpitApi.revokeSession("s1"), "DELETE", "/api/cockpit/sessions/s1", undefined],
    ["runtime", () => cockpitApi.runtime(), "GET", "/api/cockpit/runtime", undefined],
    ["logs", () => cockpitApi.logs({ levels: [], source: "", search: "" }, null), "GET", "/api/cockpit/logs", undefined],
    [
      "logs with filters and a cursor",
      () => cockpitApi.logs({ levels: ["warn", "error"], source: "Stellarr.Api", search: " disk full " }, 42),
      "GET",
      "/api/cockpit/logs?before=42&level=warn%2Cerror&source=Stellarr.Api&search=disk+full",
      undefined,
    ],
    ["backups", () => cockpitApi.backups(), "GET", "/api/cockpit/backups", undefined],
    [
      "createBackup",
      () => cockpitApi.createBackup({ database: true, objects: true, keys: false, instance: true }),
      "POST",
      "/api/cockpit/backups",
      { database: true, objects: true, keys: false, instance: true },
    ],
    ["verifyBackup", () => cockpitApi.verifyBackup("b1"), "POST", "/api/cockpit/backups/b1/verify", undefined],
    ["settings", () => cockpitApi.settings(), "GET", "/api/cockpit/settings", undefined],
    ["sendTestMail", () => cockpitApi.sendTestMail("a@b.c"), "POST", "/api/cockpit/mail/test", { to: "a@b.c" }],
    [
      "requestPasswordReset",
      () => cockpitApi.requestPasswordReset("a@b.c"),
      "POST",
      "/api/auth/password/forgot",
      { email: "a@b.c" },
    ],
    ["login", () => cockpitApi.login("ada", "pw"), "POST", "/api/auth/login", { username: "ada", password: "pw" }],
    [
      "login for this browser only",
      () => cockpitApi.login("ada", "pw", false),
      "POST",
      "/api/auth/login",
      { username: "ada", password: "pw", keepSignedIn: false },
    ],
    ["logout", () => cockpitApi.logout(), "POST", "/api/auth/logout", undefined],
  ])("%s calls %s %s", async (_name, call, method, path, body) => {
    fetchMock.mockImplementation(async () => jsonResponse({}));

    await call();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = sentRequest();
    expect(sent.init.method).toBe(method);
    expect(sent.url).toBe(path);
    expect(sent.body).toEqual(body);
  });

  it("URI-encodes ids placed in paths", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));
    const id = "a/b c?d";
    const encoded = "a%2Fb%20c%3Fd";

    await cockpitApi.setUserRole(id, "r1");
    expect(sentRequest().url).toBe(`/api/cockpit/users/${encoded}/role`);
    await cockpitApi.setUserDisabled(id, false);
    expect(sentRequest().url).toBe(`/api/cockpit/users/${encoded}/status`);
    await cockpitApi.updateRole(id, role);
    expect(sentRequest().url).toBe(`/api/cockpit/roles/${encoded}`);
    await cockpitApi.revokeSession(id);
    expect(sentRequest().url).toBe(`/api/cockpit/sessions/${encoded}`);
    await cockpitApi.verifyBackup(id);
    expect(sentRequest().url).toBe(`/api/cockpit/backups/${encoded}/verify`);
  });

  it("sends the editable settings, never the server-owned ones, an integration switch nobody flipped or an unchanged security setting", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(settings));

    await cockpitApi.updateSettings(settings);

    const { init, body } = sentRequest();
    expect(init.method).toBe("PUT");
    expect(body).toEqual({
      instanceName: "Stellarr",
      timeZone: "Europe/Warsaw",
      mailingEnabled: true,
      mailFromAddress: "cockpit@example.com",
      inviteMailEnabled: true,
      recoveryMailEnabled: false,
      alertMailEnabled: true,
      backupRetentionDays: 14,
      logRetentionDays: 30,
      orphanObjectRetentionDays: 7,
      automaticCleanupEnabled: false,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecurity: "tls",
      smtpUsername: "cockpit",
    });
  });

  it("sends an integration switch the operator flipped", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(settings));

    await cockpitApi.updateSettings(settings, { giphyEnabled: false });

    expect(sentRequest().body).toMatchObject({ giphyEnabled: false });
    expect(sentRequest().body).not.toHaveProperty("resendEnabled");
  });

  it("sends only the security settings the operator changed, with the stored rest", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(settings));

    await cockpitApi.updateSettings(settings, { mfaRequirement: "cockpit", emailCodeCooldownSeconds: 30 });

    const { init, body } = sentRequest();
    expect(init.method).toBe("PUT");
    expect(body).toEqual({
      instanceName: "Stellarr",
      timeZone: "Europe/Warsaw",
      mailingEnabled: true,
      mailFromAddress: "cockpit@example.com",
      inviteMailEnabled: true,
      recoveryMailEnabled: false,
      alertMailEnabled: true,
      backupRetentionDays: 14,
      logRetentionDays: 30,
      orphanObjectRetentionDays: 7,
      automaticCleanupEnabled: false,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecurity: "tls",
      smtpUsername: "cockpit",
      mfaRequirement: "cockpit",
      emailCodeCooldownSeconds: 30,
    });
  });

  it("builds download links without calling the server", () => {
    expect(cockpitApi.logExportUrl({ levels: [], source: "", search: "" })).toBe("/api/cockpit/logs/export");
    expect(cockpitApi.logExportUrl({ levels: ["error"], source: "", search: "" })).toBe(
      "/api/cockpit/logs/export?level=error",
    );
    expect(cockpitApi.backupDownloadUrl("a/b")).toBe("/api/cockpit/backups/a%2Fb/download");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
