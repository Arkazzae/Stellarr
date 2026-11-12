using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Stellarr.Api.Auth;
using Stellarr.Api.Auth.Security;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;
using Stellarr.Api.Operations;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

public sealed class AccountSecurityFlowTests
{
    private const string Password = "Security!2026";

    [Fact]
    public void TotpRoundTrips()
    {
        var secret = TotpService.NewSecret();
        var code = TotpService.ComputeAt(secret, DateTime.UtcNow);
        Assert.True(TotpService.Verify(secret, code, out _), $"code={code} secret={secret}");
    }

    [Fact]
    public async Task TotpEnrollmentThenCodeRecoveryAndRememberedTrustAreDistinctProofs()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);

        var login = await LoginAsync(client, account.Username);
        Assert.Equal(account.Username, login.GetProperty("username").GetString());

        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var enrollment = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start",
            new { challengeId, name = "Phone" });
        enrollment.EnsureSuccessStatusCode();
        var method = await enrollment.Content.ReadFromJsonAsync<JsonElement>();
        var methodId = method.GetProperty("methodId").GetString()!;
        var secret = method.GetProperty("secret").GetString()!;

        var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId,
                methodId,
                code = TotpService.ComputeAt(secret, DateTime.UtcNow),
                name = "Phone",
                rememberDevice = true,
            });
        confirm.EnsureSuccessStatusCode();
        var completed = await confirm.Content.ReadFromJsonAsync<JsonElement>();
        var recoveryCodes = completed.GetProperty("recoveryCodes")
            .EnumerateArray().Select(x => x.GetString()!).ToArray();
        Assert.Equal(10, recoveryCodes.Length);
        Assert.All(recoveryCodes, recoveryCode =>
            Assert.True(recoveryCode.Replace("-", "", StringComparison.Ordinal).Length >= 28));
        Assert.True(completed.GetProperty("trustedDeviceExpiresAt").GetDateTime() > DateTime.UtcNow.AddDays(13));

        var security = await client.GetFromJsonAsync<JsonElement>("/api/me/security");
        Assert.True(security.GetProperty("freshMfa").GetBoolean());
        Assert.Equal("totp", security.GetProperty("mfaEvidence").GetString());
        Assert.Equal(1, security.GetProperty("methods").GetArrayLength());
        Assert.EndsWith("Z", security.GetProperty("mfaCompletedAt").GetString());
        Assert.EndsWith("Z", security.GetProperty("methods")[0].GetProperty("createdAt").GetString());
        Assert.EndsWith("Z", security.GetProperty("trustedDevices")[0].GetProperty("expiresAt").GetString());
        Assert.EndsWith("Z", security.GetProperty("recentEvents")[0].GetProperty("createdAt").GetString());

        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        var second = await LoginAsync(client, account.Username);
        Assert.Equal("mfa_required", second.GetProperty("status").GetString());
        Assert.True(second.GetProperty("trustedDeviceAvailable").GetBoolean());
        Assert.Equal(14, second.GetProperty("trustedDeviceDays").GetInt32());

        var code = TotpService.ComputeAt(secret, NextStepStart());
        var verified = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = second.GetProperty("challengeId").GetString(),
                methodId,
                code,
                rememberDevice = true,
            });
        verified.EnsureSuccessStatusCode();
        var verifiedBody = await verified.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, verifiedBody.GetProperty("recoveryCodes").ValueKind);
        var verifierSecurity = await client.GetFromJsonAsync<JsonElement>("/api/me/security");
        Assert.True(verifierSecurity.GetProperty("freshMfa").GetBoolean());
        Assert.Equal("totp", verifierSecurity.GetProperty("mfaEvidence").GetString());

        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        var totpReplay = await LoginAsync(client, account.Username);
        var replayedCode = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = totpReplay.GetProperty("challengeId").GetString(),
                methodId,
                code,
            });
        Assert.Equal(HttpStatusCode.Unauthorized, replayedCode.StatusCode);

        var third = await LoginAsync(client, account.Username);
        Assert.True(third.GetProperty("trustedDeviceAvailable").GetBoolean());
        var trusted = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = third.GetProperty("challengeId").GetString(),
                useTrustedDevice = true,
            });
        trusted.EnsureSuccessStatusCode();
        var trustedSecurity = await client.GetFromJsonAsync<JsonElement>("/api/me/security");
        Assert.False(trustedSecurity.GetProperty("freshMfa").GetBoolean());
        Assert.Equal("trusted_device", trustedSecurity.GetProperty("mfaEvidence").GetString());
        Assert.Equal(JsonValueKind.Null, trustedSecurity.GetProperty("mfaCompletedAt").ValueKind);

        using var fallback = Client(factory);
        var fourth = await LoginAsync(fallback, account.Username);
        var recovery = await fallback.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = fourth.GetProperty("challengeId").GetString(),
                code = recoveryCodes[0],
            });
        recovery.EnsureSuccessStatusCode();
        Assert.Equal(
            "recovery",
            (await fallback.GetFromJsonAsync<JsonElement>("/api/me/security"))
                .GetProperty("mfaEvidence").GetString());

        using var replayClient = Client(factory);
        var fifth = await LoginAsync(replayClient, account.Username);
        var replay = await replayClient.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = fifth.GetProperty("challengeId").GetString(),
                code = recoveryCodes[0],
            });
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        await using (var scope = factory.OpenScope(out var db))
        {
            db.SecurityEvents.AddRange(Enumerable.Range(0, 10).Select(_ => new SecurityEvent
            {
                Id = Guid.NewGuid(),
                UserId = account.Id,
                Kind = SecurityEventKinds.MfaFailed,
                Detail = "test",
                CreatedAt = DateTime.UtcNow,
            }));
            await db.SaveChangesAsync();
        }

        using var throttled = Client(factory);
        var last = await LoginAsync(throttled, account.Username);
        var refused = await throttled.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = last.GetProperty("challengeId").GetString(),
                methodId,
                code = TotpService.ComputeAt(secret, NextStepStart()),
            });
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
    }

    [Fact]
    public async Task EmailEnrollmentUsesOnlyTheCurrentAddressAndFailedDeliveryVerifiesNothing()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "Jo@Example.test");
        using var client = Client(factory);
        await LoginAsync(client, account.Username);

        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        factory.EmailDelivery.Failure = new MailDeliveryException("provider down");

        var failed = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/start",
            new { challengeId });
        Assert.Equal(HttpStatusCode.BadGateway, failed.StatusCode);
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.False(await db.MfaMethods.AnyAsync(x => x.UserId == account.Id && x.RevokedAt == null));
            Assert.False(await db.EmailOtpCodes.AnyAsync(x => x.UserId == account.Id && x.DeliveredAt != null));
        }

        factory.EmailDelivery.Failure = null;
        var stillCooling = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/start",
            new { challengeId });
        Assert.Equal(HttpStatusCode.TooManyRequests, stillCooling.StatusCode);
        Assert.NotNull(stillCooling.Headers.RetryAfter);
        var coolingProblem = await stillCooling.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(coolingProblem.GetProperty("retryAfterSeconds").GetInt32() > 0);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.EmailOtpCodes.Where(x => x.UserId == account.Id && x.Purpose == "enrollment")
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.CreatedAt, DateTime.UtcNow.AddMinutes(-2)));
        }

        var sent = await client.PostAsJsonAsync("/api/auth/mfa/enroll/email/start", new { challengeId });
        sent.EnsureSuccessStatusCode();
        Assert.Equal(45, (await sent.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("retryAfterSeconds").GetInt32());
        var messages = factory.EmailDelivery.Messages;
        var message = messages[messages.Count - 1];
        Assert.Equal("Jo@Example.test", message.To);
        var code = Regex.Match(message.Text, @"\b\d{6}\b").Value;
        Assert.Equal(6, code.Length);

        var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/confirm",
            new { challengeId, code, name = "Work mail" });
        confirm.EnsureSuccessStatusCode();
        var completed = await confirm.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(10, completed.GetProperty("recoveryCodes").GetArrayLength());

        await using (var scope = factory.OpenScope(out var db))
        {
            var method = await db.MfaMethods.SingleAsync(x => x.UserId == account.Id && x.Type == "email");
            Assert.Equal("JO@EXAMPLE.TEST", method.EmailAddress);
            await db.EmailOtpCodes.Where(x => x.UserId == account.Id).ExecuteUpdateAsync(
                setters => setters.SetProperty(x => x.CreatedAt, DateTime.UtcNow.AddMinutes(-2)));
        }

        await EnableAlertsAsync(factory);
        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        var emailLogin = await LoginAsync(client, account.Username);
        Assert.Equal("mfa_required", emailLogin.GetProperty("status").GetString());
        var emailMethodId = emailLogin.GetProperty("methods").EnumerateArray()
            .Single(x => x.GetProperty("type").GetString() == "email")
            .GetProperty("id").GetString();
        var codeSent = await client.PostAsJsonAsync(
            "/api/auth/mfa/email/send",
            new { challengeId = emailLogin.GetProperty("challengeId").GetString(), methodId = emailMethodId });
        codeSent.EnsureSuccessStatusCode();
        var loginMessages = factory.EmailDelivery.Messages;
        var loginCode = Regex.Match(loginMessages[loginMessages.Count - 1].Text, @"\b\d{6}\b").Value;
        var emailVerified = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = emailLogin.GetProperty("challengeId").GetString(),
                methodId = emailMethodId,
                code = loginCode,
            });
        emailVerified.EnsureSuccessStatusCode();
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.True(await db.MfaMethods.AnyAsync(
                x => x.UserId == account.Id && x.Type == "email" && x.EmailAddress == "JO@EXAMPLE.TEST"));
            Assert.True(await db.SecurityEvents.AnyAsync(
                x => x.UserId == account.Id && x.Kind == "login-succeeded"));
            var notifications = await db.SecurityNotifications.ToArrayAsync();
            Assert.True(
                notifications.Any(x => x.UserId == account.Id && x.EmailAddress == "Jo@Example.test"),
                string.Join(", ", notifications.Select(x => $"{x.UserId}:{x.EmailAddress}")));
            await scope.ServiceProvider.GetRequiredService<SecurityNotificationDispatcher>()
                .DispatchAsync(DateTime.UtcNow, CancellationToken.None);
            db.ChangeTracker.Clear();
            Assert.All(
                await db.SecurityNotifications.Where(x => x.UserId == account.Id).ToArrayAsync(),
                notification => Assert.NotNull(notification.SentAt));
            Assert.Contains(
                await db.SecurityEvents.ToArrayAsync(),
                securityEvent => securityEvent.UserId == account.Id && securityEvent.Kind == "login-succeeded");
        }

        // The method is bound to the address it was verified with.
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Users.Where(x => x.Id == account.Id).ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.Email, "new@example.test")
                .SetProperty(x => x.NormalizedEmail, "NEW@EXAMPLE.TEST"));
        }

        using var other = Client(factory);
        var login = await LoginAsync(other, account.Username);
        Assert.Equal("mfa_required", login.GetProperty("status").GetString());
        var methodId = login.GetProperty("methods").EnumerateArray()
            .Single(x => x.GetProperty("type").GetString() == "email")
            .GetProperty("id").GetString();
        var refused = await other.PostAsJsonAsync(
            "/api/auth/mfa/email/send",
            new { challengeId = login.GetProperty("challengeId").GetString(), methodId });
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
    }

    [Fact]
    public async Task RequiredPolicyBlocksNewAndExistingSessionsAndCockpitNeedsFreshMfa()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        var login = await LoginAsync(client, account.Username);
        Assert.Equal(account.Username, login.GetProperty("username").GetString());

        await SetRequirementAsync(factory, MfaRequirements.Everyone);

        var blocked = await client.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, blocked.GetProperty("user").ValueKind);
        using var fresh = Client(factory);
        var challenge = await LoginAsync(fresh, account.Username);
        Assert.Equal("mfa_enrollment_required", challenge.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null,
            (await fresh.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.Equal(1, await db.UserSessions.CountAsync(x => x.UserId == account.Id));
        }

        await SetRequirementAsync(factory, MfaRequirements.Optional);
        using var ownerClient = Client(factory);
        await LoginAsync(ownerClient, "maja", "Aurora!2026");
        await SetRequirementAsync(factory, MfaRequirements.Cockpit);
        using var cockpit = await ownerClient.GetAsync("/api/cockpit/bootstrap");
        Assert.Equal(HttpStatusCode.Forbidden, cockpit.StatusCode);
        Assert.Equal(
            "cockpit-mfa-required",
            (await cockpit.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(JsonValueKind.Object,
            (await ownerClient.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task OwnSessionsCanBeListedAndSignedOutExceptTheCurrentOne()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var laptop = Client(factory);
        using var phone = Client(factory);
        await LoginAsync(laptop, account.Username);
        await LoginAsync(phone, account.Username);

        var listed = await laptop.GetFromJsonAsync<JsonElement>("/api/me/security/sessions");
        Assert.Equal(2, listed.GetArrayLength());
        var current = listed.EnumerateArray().Single(x => x.GetProperty("current").GetBoolean());
        var other = listed.EnumerateArray().Single(x => !x.GetProperty("current").GetBoolean());
        Assert.EndsWith("Z", other.GetProperty("lastSeenAt").GetString());

        Assert.Equal(
            HttpStatusCode.Conflict,
            (await laptop.DeleteAsync($"/api/me/security/sessions/{current.GetProperty("id").GetString()}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await laptop.DeleteAsync($"/api/me/security/sessions/{other.GetProperty("id").GetString()}")).StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await phone.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
        Assert.Equal(JsonValueKind.Object,
            (await laptop.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);

        // Somebody else's session is not this account's to end.
        var stranger = await CreateAccountAsync(factory);
        using var strangerClient = Client(factory);
        await LoginAsync(strangerClient, stranger.Username);
        var strangerSession = (await strangerClient.GetFromJsonAsync<JsonElement>("/api/me/security/sessions"))[0]
            .GetProperty("id").GetString();
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await laptop.DeleteAsync($"/api/me/security/sessions/{strangerSession}")).StatusCode);

        using var tablet = Client(factory);
        await LoginAsync(tablet, account.Username);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await laptop.PostAsync("/api/me/security/sessions/revoke-others", null)).StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await tablet.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
        Assert.Equal(1, (await laptop.GetFromJsonAsync<JsonElement>("/api/me/security/sessions")).GetArrayLength());
        Assert.Contains(
            (await laptop.GetFromJsonAsync<JsonElement>("/api/me/security")).GetProperty("recentEvents").EnumerateArray(),
            x => x.GetProperty("kind").GetString() == "session-revoked");
    }

    [Fact]
    public async Task RevocationWatcherAbortsAConnectionRevokedByAnotherProcess()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);

        Guid sessionId;
        await using (var scope = factory.OpenScope(out var db))
        {
            sessionId = await db.UserSessions.Where(x => x.UserId == account.Id)
                .Select(x => x.Id).SingleAsync();
        }

        var registry = factory.Services.GetRequiredService<HubConnectionRegistry>();
        var aborted = false;
        registry.Register("test-connection", account.Id, sessionId, 0, () => aborted = true);
        var watcher = factory.Services.GetServices<IHostedService>()
            .OfType<SessionRevocationWatcher>().Single();

        await using (var scope = factory.OpenScope(out var db))
        {
            await db.UserSessions.Where(x => x.Id == sessionId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, DateTime.UtcNow));
        }

        await watcher.SweepAsync(DateTime.UtcNow, CancellationToken.None);
        Assert.True(aborted);
        registry.Unregister("test-connection");
    }

    private static DateTime NextStepStart()
    {
        const long stepTicks = 30 * TimeSpan.TicksPerSecond;
        var now = DateTime.UtcNow.Ticks;
        return new DateTime((now / stepTicks + 1) * stepTicks, DateTimeKind.Utc);
    }

    [Fact]
    public async Task PendingFlowCanBeResumedAndCancelledFromTheServer()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);

        var started = await StartEnrollmentAsync(client);
        var challengeId = started.GetProperty("challengeId").GetString();

        var pending = await client.GetAsync("/api/auth/mfa/pending");
        pending.EnsureSuccessStatusCode();
        Assert.Equal("no-store", pending.Headers.CacheControl?.ToString());
        var resumed = await pending.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(challengeId, resumed.GetProperty("challengeId").GetString());
        Assert.Equal("mfa_enrollment_required", resumed.GetProperty("status").GetString());
        // Read back from SQLite the expiry has no kind; the wire must still say UTC,
        // as it does in the answer that started the challenge.
        Assert.Equal(
            started.GetProperty("expiresAt").GetString(),
            resumed.GetProperty("expiresAt").GetString());
        Assert.EndsWith("Z", resumed.GetProperty("expiresAt").GetString());
        Assert.DoesNotContain("secret", await pending.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/mfa/cancel", null)).StatusCode);
        var cancelled = await client.GetAsync("/api/auth/mfa/pending");
        Assert.Equal(HttpStatusCode.Unauthorized, cancelled.StatusCode);
    }

    [Fact]
    public async Task FactorChangesRequireRecentActualMfaNotPasswordOrTrustedSession()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var enrolled = await EnrollTotpAsync(client, rememberDevice: true);

        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        var challenge = await LoginAsync(client, account.Username);
        var actual = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                methodId = enrolled.MethodId.ToString(),
                code = TotpService.ComputeAt(enrolled.Secret, NextStepStart()),
            });
        actual.EnsureSuccessStatusCode();

        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow.AddMinutes(-15));
        var stale = await client.PostAsJsonAsync(
            $"/api/me/security/mfa/{enrolled.MethodId}/remove",
            new { password = Password });
        Assert.Equal(HttpStatusCode.Forbidden, stale.StatusCode);

        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        var trustedChallenge = await LoginAsync(client, account.Username);
        var trusted = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = trustedChallenge.GetProperty("challengeId").GetString(),
                useTrustedDevice = true,
            });
        trusted.EnsureSuccessStatusCode();
        var passwordOnly = await client.PostAsJsonAsync(
            "/api/me/security/mfa/{enrolled.MethodId}/remove".Replace("{enrolled.MethodId}", enrolled.MethodId.ToString(), StringComparison.Ordinal),
            new { password = Password });
        Assert.Equal(HttpStatusCode.Forbidden, passwordOnly.StatusCode);
        var regenerate = await client.PostAsJsonAsync(
            "/api/me/security/recovery/regenerate",
            new { password = Password });
        Assert.Equal(HttpStatusCode.Forbidden, regenerate.StatusCode);

        var reverify = await client.PostAsync("/api/me/security/mfa/reverify/start", null);
        reverify.EnsureSuccessStatusCode();
        var reverifyChallenge = await reverify.Content.ReadFromJsonAsync<JsonElement>();
        var recovery = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = reverifyChallenge.GetProperty("challengeId").GetString(),
                code = enrolled.RecoveryCodes[0],
            });
        recovery.EnsureSuccessStatusCode();

        var removed = await client.PostAsJsonAsync(
            $"/api/me/security/mfa/{enrolled.MethodId}/remove",
            new { });
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
    }

    [Fact]
    public async Task FirstEnrollmentNeedsRecentPrimaryProofOrPassword()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await SetSessionPrimaryTimeAsync(factory, account.Id, DateTime.UtcNow.AddMinutes(-30));

        var stale = await client.PostAsync("/api/me/security/mfa/enroll/start", null);
        Assert.Equal(HttpStatusCode.Forbidden, stale.StatusCode);
        var reauthenticated = await client.PostAsJsonAsync(
            "/api/me/security/mfa/enroll/start",
            new { password = Password });
        reauthenticated.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ConcurrentRecoveryCodeRegenerationLeavesOneActiveBatch()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var method = await AddConfirmedTotpAsync(factory, account);
        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow);

        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            client.PostAsJsonAsync("/api/me/security/recovery/regenerate", new { })));

        Assert.All(responses, response => response.EnsureSuccessStatusCode());
        await using var scope = factory.OpenScope(out var db);
        var unused = await db.RecoveryCodes.AsNoTracking()
            .Where(x => x.UserId == account.Id && x.UsedAt == null)
            .ToArrayAsync();
        Assert.Single(unused.Select(x => x.BatchId).Distinct());
        Assert.Equal(10, unused.Length);
        Assert.NotEqual(Guid.Empty, method);
    }

    [Fact]
    public async Task ConcurrentMethodRemovalsCannotRemoveTheLastMethodUnderPolicy()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var first = await AddConfirmedTotpAsync(factory, account);
        var second = await AddConfirmedTotpAsync(factory, account);
        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow);
        await SetRequirementAsync(factory, MfaRequirements.Everyone);

        var responses = await Task.WhenAll(
            client.PostAsJsonAsync($"/api/me/security/mfa/{first}/remove", new { }),
            client.PostAsJsonAsync($"/api/me/security/mfa/{second}/remove", new { }));

        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(
            1,
            await db.MfaMethods.CountAsync(x => x.UserId == account.Id && x.RevokedAt == null));
        Assert.Contains(responses, response =>
            response.StatusCode is HttpStatusCode.NoContent or HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task MfaCompletionFailsClosedAfterSecurityVersionChanges()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var enrolled = await EnrollTotpAsync(client);
        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();

        var challenge = await LoginAsync(client, account.Username);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Users.Where(x => x.Id == account.Id).ExecuteUpdateAsync(
                setters => setters.SetProperty(x => x.SessionVersion, x => x.SessionVersion + 1));
        }

        var verify = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                methodId = enrolled.MethodId.ToString(),
                code = TotpService.ComputeAt(enrolled.Secret, NextStepStart()),
            });
        Assert.Equal(HttpStatusCode.Unauthorized, verify.StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await client.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task PolicyIsReadFromTheInstanceServerNotANewerSecondaryRow()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        await SetRequirementAsync(factory, MfaRequirements.Everyone);
        await using (var scope = factory.OpenScope(out var db))
        {
            var secondary = new StellarrServer
            {
                Id = Guid.NewGuid(),
                Name = "Secondary",
                CreatedAt = DateTime.UtcNow.AddDays(1),
            };
            db.Servers.Add(secondary);
            db.OperationsSettings.Add(new OperationsSettings
            {
                ServerId = secondary.Id,
                PublicUrl = "",
                TimeZone = "UTC",
                MfaRequirement = MfaRequirements.Optional,
                UpdatedAt = DateTime.UtcNow.AddDays(30),
            });
            await db.SaveChangesAsync();
        }

        using var client = Client(factory);
        var login = await LoginAsync(client, account.Username);
        Assert.Equal("mfa_enrollment_required", login.GetProperty("status").GetString());
    }

    [Fact]
    public async Task DeliveredEmailCodeCannotCrossChallengesOrSurviveAnAddressChange()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "Jo@Example.test");
        await AddConfirmedEmailAsync(factory, account, "Jo@Example.test");
        await SetEmailPolicyAsync(factory);

        using var first = Client(factory);
        var firstLogin = await LoginAsync(first, account.Username);
        var methodId = firstLogin.GetProperty("methods").EnumerateArray()
            .Single(x => x.GetProperty("type").GetString() == "email")
            .GetProperty("id").GetString();
        var send = await first.PostAsJsonAsync(
            "/api/auth/mfa/email/send",
            new { challengeId = firstLogin.GetProperty("challengeId").GetString(), methodId });
        send.EnsureSuccessStatusCode();
        var messages = factory.EmailDelivery.Messages;
        var oldCode = Regex.Match(messages[messages.Count - 1].Text, @"\b\d{6}\b").Value;

        using var second = Client(factory);
        var secondLogin = await LoginAsync(second, account.Username);
        var crossChallenge = await second.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = secondLogin.GetProperty("challengeId").GetString(),
                methodId,
                code = oldCode,
            });
        Assert.Equal(HttpStatusCode.Unauthorized, crossChallenge.StatusCode);

        await using (var scope = factory.OpenScope(out var db))
        {
            await db.Users.Where(x => x.Id == account.Id).ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.Email, "new@example.test")
                .SetProperty(x => x.NormalizedEmail, "NEW@EXAMPLE.TEST"));
        }

        var staleAddress = await first.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = firstLogin.GetProperty("challengeId").GetString(),
                methodId,
                code = oldCode,
            });
        Assert.Equal(HttpStatusCode.Unauthorized, staleAddress.StatusCode);
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.True(await db.MfaMethods.Where(x => x.Id == Guid.Parse(methodId!)).Select(x => x.RevokedAt).SingleAsync() is not null);
            Assert.All(
                await db.EmailOtpCodes.Where(x => x.UserId == account.Id).ToArrayAsync(),
                code => Assert.NotNull(code.ConsumedAt));
        }
    }

    [Fact]
    public async Task ConcurrentEmailSendsReserveTheHourlyBudgetOnce()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "Jo@Example.test");
        await AddConfirmedEmailAsync(factory, account, "Jo@Example.test");
        await SetEmailSendBudgetAsync(factory, sendsPerHour: 1, cooldownSeconds: 0);

        using var client = Client(factory);
        var login = await LoginAsync(client, account.Username);
        var methodId = login.GetProperty("methods").EnumerateArray()
            .Single(x => x.GetProperty("type").GetString() == "email")
            .GetProperty("id").GetString();

        var responses = await Task.WhenAll(
            client.PostAsJsonAsync("/api/auth/mfa/email/send", new { challengeId = login.GetProperty("challengeId").GetString(), methodId }),
            client.PostAsJsonAsync("/api/auth/mfa/email/send", new { challengeId = login.GetProperty("challengeId").GetString(), methodId }));

        Assert.Single(responses, response => response.IsSuccessStatusCode);
        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.TooManyRequests);
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.EmailOtpCodes.CountAsync(x => x.UserId == account.Id));
    }

    [Fact]
    public async Task ReverificationDiesWithItsParentSessionAndNeverUsesRememberedTrust()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var enrolled = await EnrollTotpAsync(client, rememberDevice: true);

        var start = await client.PostAsync("/api/me/security/mfa/reverify/start", null);
        start.EnsureSuccessStatusCode();
        var challenge = await start.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(challenge.GetProperty("trustedDeviceAvailable").GetBoolean());

        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();

        var trusted = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                useTrustedDevice = true,
            });
        Assert.Equal(HttpStatusCode.Unauthorized, trusted.StatusCode);
        var actual = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                code = enrolled.RecoveryCodes[0],
            });
        Assert.Equal(HttpStatusCode.Unauthorized, actual.StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await client.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task RevokedTrustedDeviceCannotCompleteAnAlreadyStartedLogin()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await EnrollTotpAsync(client, rememberDevice: true);
        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();

        var challenge = await LoginAsync(client, account.Username);
        Assert.True(challenge.GetProperty("trustedDeviceAvailable").GetBoolean());
        await using (var scope = factory.OpenScope(out var db))
        {
            var now = DateTime.UtcNow;
            await db.TrustedDevices.Where(x => x.UserId == account.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now));
        }

        var verify = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                useTrustedDevice = true,
            });
        Assert.Equal(HttpStatusCode.Unauthorized, verify.StatusCode);
        Assert.Equal(JsonValueKind.Null,
            (await client.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task SecurityMetadataReportsBoundedFreshnessAndCapabilities()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await EnrollTotpAsync(client);

        var fresh = await client.GetFromJsonAsync<JsonElement>("/api/me/security");
        Assert.True(fresh.GetProperty("freshMfa").GetBoolean());
        Assert.Equal(300, fresh.GetProperty("freshMfaWindowSeconds").GetInt32());
        Assert.Equal(14, fresh.GetProperty("trustedDeviceDays").GetInt32());
        Assert.False(fresh.GetProperty("emailCodeAvailable").GetBoolean());
        Assert.Equal(45, fresh.GetProperty("emailResendCooldownSeconds").GetInt32());

        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow.AddMinutes(-10));
        var stale = await client.GetFromJsonAsync<JsonElement>("/api/me/security");
        Assert.False(stale.GetProperty("freshMfa").GetBoolean());
    }

    [Fact]
    public async Task EnrollmentConfirmationSharesThePersistentFailureThrottle()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var start = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start",
            new { challengeId, name = "Phone" });
        start.EnsureSuccessStatusCode();
        var method = await start.Content.ReadFromJsonAsync<JsonElement>();

        await using (var scope = factory.OpenScope(out var db))
        {
            db.SecurityEvents.AddRange(Enumerable.Range(0, 10).Select(_ => new SecurityEvent
            {
                Id = Guid.NewGuid(),
                UserId = account.Id,
                Kind = SecurityEventKinds.MfaFailed,
                Detail = "test",
                CreatedAt = DateTime.UtcNow,
            }));
            await db.SaveChangesAsync();
        }

        var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId,
                methodId = method.GetProperty("methodId").GetString(),
                code = TotpService.ComputeAt(method.GetProperty("secret").GetString()!, DateTime.UtcNow),
            });
        Assert.Equal(HttpStatusCode.TooManyRequests, confirm.StatusCode);
    }

    [Fact]
    public async Task EmailOnlyAccountCanReverifyAndThenChangeSecurity()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "Jo@Example.test");
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await AddConfirmedEmailAsync(factory, account, "Jo@Example.test");

        var start = await client.PostAsync("/api/me/security/mfa/reverify/start", null);
        start.EnsureSuccessStatusCode();
        var challenge = await start.Content.ReadFromJsonAsync<JsonElement>();
        var methodId = challenge.GetProperty("methods").EnumerateArray()
            .Single(x => x.GetProperty("type").GetString() == "email")
            .GetProperty("id").GetString();
        var send = await client.PostAsJsonAsync(
            "/api/auth/mfa/email/send",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                methodId,
            });
        send.EnsureSuccessStatusCode();
        var messages = factory.EmailDelivery.Messages;
        var code = Regex.Match(messages[messages.Count - 1].Text, @"\b\d{6}\b").Value;
        var verify = await client.PostAsJsonAsync(
            "/api/auth/mfa/verify",
            new
            {
                challengeId = challenge.GetProperty("challengeId").GetString(),
                methodId,
                code,
            });
        verify.EnsureSuccessStatusCode();

        var remove = await client.PostAsJsonAsync(
            $"/api/me/security/mfa/{methodId}/remove",
            new { });
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
    }

    [Fact]
    public async Task InvalidEnrollmentMethodNameDoesNotSpendTheValidEmailCode()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "Jo@Example.test");
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var sent = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/start",
            new { challengeId });
        sent.EnsureSuccessStatusCode();
        var messages = factory.EmailDelivery.Messages;
        var code = Regex.Match(messages[messages.Count - 1].Text, @"\b\d{6}\b").Value;

        var invalidName = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/confirm",
            new { challengeId, code, name = new string('x', 65) });
        Assert.Equal(HttpStatusCode.BadRequest, invalidName.StatusCode);

        var retry = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/confirm",
            new { challengeId, code, name = "Mail" });
        retry.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task RemovingTheVerifiedEmailMethodCapturesItsAlertRecipientBeforeRevocation()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "Jo@Example.test");
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await AddConfirmedEmailAsync(factory, account, "Jo@Example.test");
        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow);
        await EnableAlertsAsync(factory);

        await using (var scope = factory.OpenScope(out var db))
        {
            var methodId = await db.MfaMethods.Where(x => x.UserId == account.Id).Select(x => x.Id).SingleAsync();
            var remove = await client.PostAsJsonAsync(
                $"/api/me/security/mfa/{methodId}/remove",
                new { });
            Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        }

        await using var check = factory.OpenScope(out var checkDb);
        Assert.Contains(
            await checkDb.SecurityEvents.Where(x => x.UserId == account.Id).ToArrayAsync(),
            securityEvent => securityEvent.Kind == "method-removed");
        Assert.Equal(
            "Jo@Example.test",
            (await checkDb.SecurityNotifications.SingleAsync(x => x.UserId == account.Id)).EmailAddress);
    }

    private sealed record EnrolledTotp(Guid MethodId, string Secret, string[] RecoveryCodes);

    private static async Task<EnrolledTotp> EnrollTotpAsync(HttpClient client, bool rememberDevice = false)
    {
        var challenge = await StartEnrollmentAsync(client);
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var start = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start",
            new { challengeId, name = "Phone" });
        start.EnsureSuccessStatusCode();
        var draft = await start.Content.ReadFromJsonAsync<JsonElement>();
        var methodId = Guid.Parse(draft.GetProperty("methodId").GetString()!);
        var secret = draft.GetProperty("secret").GetString()!;
        var confirm = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId,
                methodId,
                code = TotpService.ComputeAt(secret, DateTime.UtcNow),
                name = "Phone",
                rememberDevice,
            });
        confirm.EnsureSuccessStatusCode();
        var completed = await confirm.Content.ReadFromJsonAsync<JsonElement>();
        return new EnrolledTotp(
            methodId,
            secret,
            completed.GetProperty("recoveryCodes").EnumerateArray()
                .Select(x => x.GetString()!).ToArray());
    }

    private static async Task<Guid> AddConfirmedTotpAsync(
        StellarrWebApplicationFactory factory,
        User account)
    {
        await using var scope = factory.OpenScope(out var db);
        var method = new MfaMethod
        {
            Id = Guid.NewGuid(),
            UserId = account.Id,
            Type = MfaMethodTypes.Totp,
            Name = "Seeded",
            CreatedAt = DateTime.UtcNow,
            ConfirmedAt = DateTime.UtcNow,
            LastTotpStep = 1,
        };
        db.MfaMethods.Add(method);
        await db.SaveChangesAsync();
        return method.Id;
    }

    private static async Task AddConfirmedEmailAsync(
        StellarrWebApplicationFactory factory,
        User account,
        string email)
    {
        await using var scope = factory.OpenScope(out var db);
        db.MfaMethods.Add(new MfaMethod
        {
            Id = Guid.NewGuid(),
            UserId = account.Id,
            Type = MfaMethodTypes.Email,
            Name = "Mail",
            CreatedAt = DateTime.UtcNow,
            ConfirmedAt = DateTime.UtcNow,
            EmailAddress = email.ToUpperInvariant(),
        });
        await db.SaveChangesAsync();
    }

    private static async Task SetEmailPolicyAsync(StellarrWebApplicationFactory factory)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
        var settings = await InstanceSettingsService.LoadAsync(
            db, server, scope.ServiceProvider.GetRequiredService<IConfiguration>(), CancellationToken.None);
        settings.MailingEnabled = true;
        settings.EmailCodeCooldownSeconds = 0;
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    private static async Task SetEmailSendBudgetAsync(
        StellarrWebApplicationFactory factory,
        int sendsPerHour,
        int cooldownSeconds)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
        var settings = await InstanceSettingsService.LoadAsync(
            db, server, scope.ServiceProvider.GetRequiredService<IConfiguration>(), CancellationToken.None);
        settings.MailingEnabled = true;
        settings.EmailCodeSendsPerHour = sendsPerHour;
        settings.EmailCodeCooldownSeconds = cooldownSeconds;
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    private static async Task SetSessionMfaTimeAsync(
        StellarrWebApplicationFactory factory,
        Guid userId,
        DateTime completedAt)
    {
        await using var scope = factory.OpenScope(out var db);
        await db.UserSessions.Where(x => x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.MfaCompletedAt, completedAt));
    }

    private static async Task SetSessionPrimaryTimeAsync(
        StellarrWebApplicationFactory factory,
        Guid userId,
        DateTime authenticatedAt)
    {
        await using var scope = factory.OpenScope(out var db);
        await db.UserSessions.Where(x => x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.AuthenticatedAt, authenticatedAt)
                .SetProperty(x => x.CreatedAt, authenticatedAt));
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) => factory.CreateClient(
        new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task<User> CreateAccountAsync(
        StellarrWebApplicationFactory factory,
        string? email = null)
    {
        await using var scope = factory.OpenScope(out var db);
        var user = (await DataModelSupport.AddUsersAsync(db, 1))[0];
        user.PasswordHash = scope.ServiceProvider.GetRequiredService<PasswordService>().Hash(Password);
        user.Email = email;
        user.NormalizedEmail = email?.ToUpperInvariant();
        await db.SaveChangesAsync();
        return user;
    }

    private static async Task<JsonElement> LoginAsync(
        HttpClient client,
        string username,
        string password = Password)
    {
        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { username, password });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<JsonElement> StartEnrollmentAsync(HttpClient client)
    {
        var response = await client.PostAsync("/api/me/security/mfa/enroll/start", null);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task SetRequirementAsync(StellarrWebApplicationFactory factory, string requirement)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
        var settings = await InstanceSettingsService.LoadAsync(
            db,
            server,
            scope.ServiceProvider.GetRequiredService<IConfiguration>(),
            CancellationToken.None);
        settings.MfaRequirement = requirement;
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    private static async Task EnableAlertsAsync(StellarrWebApplicationFactory factory)
    {
        await using var scope = factory.OpenScope(out var db);
        var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
        var settings = await InstanceSettingsService.LoadAsync(
            db,
            server,
            scope.ServiceProvider.GetRequiredService<IConfiguration>(),
            CancellationToken.None);
        settings.MailingEnabled = true;
        settings.AlertMailEnabled = true;
        settings.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }
}
