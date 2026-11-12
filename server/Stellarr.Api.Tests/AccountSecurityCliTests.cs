using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class AccountSecurityCliTests
{
    [Fact]
    public async Task SecurityShowExposesMetadataButNeverSeedMaterial()
    {
        using var fixture = await CliFixture.StartAsync();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            db.MfaMethods.Add(new MfaMethod
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Type = MfaMethodTypes.Totp,
                Name = "Phone",
                CreatedAt = DateTime.UtcNow,
                ConfirmedAt = DateTime.UtcNow,
                ProtectedSecret = "PROTECTED-SEED-MUST-NOT-LEAK",
            });
            await db.SaveChangesAsync();
        }

        var show = await fixture.RunAsync("--json", "security", "show", "jo");
        Assert.Equal(0, show.ExitCode);
        Assert.DoesNotContain("PROTECTED-SEED-MUST-NOT-LEAK", show.Output, StringComparison.Ordinal);
        using var json = JsonDocument.Parse(show.Output);
        var data = json.RootElement.GetProperty("data");
        var method = Assert.Single(data.GetProperty("methods").EnumerateArray());
        Assert.Equal("Phone", method.GetProperty("name").GetString());
        Assert.Equal("totp", method.GetProperty("type").GetString());
        Assert.True(method.GetProperty("confirmed").GetBoolean());
        Assert.Equal("optional", data.GetProperty("policy").GetProperty("mfaRequirement").GetString());

        var methods = await fixture.RunAsync("--json", "security", "methods", "jo");
        Assert.Equal(0, methods.ExitCode);
        Assert.DoesNotContain("PROTECTED-SEED-MUST-NOT-LEAK", methods.Output, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RecoverRevokesEverythingAndIssuesOnlyAnEnrollmentCredential()
    {
        using var fixture = await CliFixture.StartAsync();
        Guid userId;
        Guid sessionId;
        Guid handoffId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            user.Email = "jo@example.test";
            user.NormalizedEmail = "JO@EXAMPLE.TEST";
            userId = user.Id;
            sessionId = Guid.NewGuid();
            handoffId = Guid.NewGuid();
            var now = DateTime.UtcNow;
            var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
            var settings = await Stellarr.Api.Operations.InstanceSettingsService.LoadAsync(
                db, server,
                scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>(),
                CancellationToken.None);
            settings.MailingEnabled = true;
            settings.AlertMailEnabled = true;
            settings.UpdatedAt = now;
            db.MfaMethods.Add(new MfaMethod
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Type = MfaMethodTypes.Email,
                Name = "Mail",
                CreatedAt = now,
                ConfirmedAt = now,
                EmailAddress = "JO@EXAMPLE.TEST",
            });
            db.TrustedDevices.Add(new TrustedDevice
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                TokenHash = DataModelSupport.Hash(),
                Name = "Laptop",
                Device = "Test",
                CreatedAt = now,
                ExpiresAt = now.AddDays(14),
            });
            db.RecoveryCodes.Add(new RecoveryCode
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                BatchId = Guid.NewGuid(),
                CodeHash = DataModelSupport.Hash(),
                CreatedAt = now,
            });
            db.UserSessions.Add(new UserSession
            {
                Id = sessionId,
                UserId = user.Id,
                Device = "Test",
                IpAddress = "192.0.2.1",
                CreatedAt = now,
                LastSeenAt = now,
                ExpiresAt = now.AddDays(1),
                AbsoluteExpiresAt = now.AddDays(1),
                PrimarySource = "password",
                SecurityVersion = user.SessionVersion,
            });
            db.DesktopBrowserLogins.Add(new DesktopBrowserLogin
            {
                Id = handoffId,
                SecretHash = new string('a', 64),
                UserId = user.Id,
                CreatedAt = now,
                ExpiresAt = now.AddMinutes(2),
                ApprovedAt = now,
            });
            await db.SaveChangesAsync();
        }

        var before = await fixture.RunAsync("--json", "security", "show", "jo");
        using (var json = JsonDocument.Parse(before.Output))
        {
            Assert.Equal(1, json.RootElement.GetProperty("data").GetProperty("trustedDevices").GetArrayLength());
        }

        var recover = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "lost phone", "--yes");
        Assert.Equal(0, recover.ExitCode);
        string credential;
        using (var json = JsonDocument.Parse(recover.Output))
        {
            var data = json.RootElement.GetProperty("data");
            credential = data.GetProperty("recoveryCredential").GetString()!;
            Assert.Equal(1, data.GetProperty("methodsRevoked").GetInt32());
            Assert.Equal(1, data.GetProperty("trustedDevicesRevoked").GetInt32());
            Assert.Equal(1, data.GetProperty("sessionsRevoked").GetInt32());
            Assert.Equal(1, data.GetProperty("handoffsInvalidated").GetInt32());
            Assert.True(data.GetProperty("recoveryExpiresAt").GetDateTime() > DateTime.UtcNow.AddMinutes(8));
        }

        Assert.Contains(credential, recover.Output, StringComparison.Ordinal);
        await using (var db = fixture.OpenDb())
        {
            Assert.All(await db.MfaMethods.ToArrayAsync(), method => Assert.NotNull(method.RevokedAt));
            Assert.All(await db.TrustedDevices.ToArrayAsync(), device => Assert.NotNull(device.RevokedAt));
            Assert.All(await db.UserSessions.ToArrayAsync(), session => Assert.NotNull(session.RevokedAt));
            Assert.NotNull((await db.DesktopBrowserLogins.SingleAsync(x => x.Id == handoffId)).RedeemedAt);
            Assert.All(await db.RecoveryCodes.ToArrayAsync(), code => Assert.NotNull(code.UsedAt));
            var stored = await db.CliRecoveryCredentials.SingleAsync();
            Assert.NotEqual(credential, stored.TokenHash);
            Assert.Equal("lost phone", stored.Reason);
            Assert.Equal("security.recover", (await db.OperatorAuditEntries.SingleAsync()).Operation);
            Assert.Equal(1, (await db.Users.SingleAsync(x => x.Id == userId)).SessionVersion);
            Assert.True((await db.Users.SingleAsync(x => x.Id == userId)).SecurityRecoveryRequired);
            var securityEvent = await db.SecurityEvents.SingleAsync(x => x.UserId == userId);
            Assert.Equal("cli-recovery", securityEvent.Kind);
            Assert.Contains("lost phone", securityEvent.Detail, StringComparison.Ordinal);
            var notification = await db.SecurityNotifications.SingleAsync(x => x.UserId == userId);
            Assert.Equal("jo@example.test", notification.EmailAddress);
        }

        using var client = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var redeemed = await client.PostAsJsonAsync(
            "/api/auth/recovery/redeem",
            new { credential });
        redeemed.EnsureSuccessStatusCode();
        var challenge = await redeemed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("mfa_enrollment_required", challenge.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null,
            (await client.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);

        var replay = await fixture.Factory.CreateClient().PostAsJsonAsync(
            "/api/auth/recovery/redeem",
            new { credential });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
    }

    [Fact]
    public async Task SecuritySettingsUseSharedValidationAndNeverBreakOptionalDefaults()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        var list = await fixture.RunAsync("--json", "config", "get", "mfa.requirement");
        Assert.Equal(0, list.ExitCode);
        using (var json = JsonDocument.Parse(list.Output))
        {
            Assert.Equal("optional", json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }

        var set = await fixture.RunAsync(
            "--json", "config", "set", "mfa.requirement", "everyone", "--yes");
        Assert.Equal(0, set.ExitCode);
        using (var json = JsonDocument.Parse(set.Output))
        {
            Assert.Equal("everyone", json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }

        var invalid = await fixture.RunAsync(
            "--json", "config", "set", "mfa.requirement", "sometimes", "--yes");
        Assert.Equal(2, invalid.ExitCode);
        using (var json = JsonDocument.Parse(invalid.Output))
        {
            Assert.Equal("invalid_value", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        var range = await fixture.RunAsync(
            "--json", "config", "set", "mfa.email-code-minutes", "99", "--yes");
        Assert.Equal(2, range.ExitCode);

        await using var db = fixture.OpenDb();
        var settings = await db.OperationsSettings.SingleAsync();
        Assert.Equal(MfaRequirements.Everyone, settings.MfaRequirement);
        Assert.Equal(8, settings.EmailCodeMinutes);
    }

    [Fact]
    public async Task OperatorSeesAndRemovesAnIdentityLinkThatARecoveryKeeps()
    {
        using var fixture = await CliFixture.StartAsync();
        Guid identityId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            identityId = Guid.NewGuid();
            db.ExternalIdentities.Add(new ExternalIdentity
            {
                Id = identityId,
                UserId = user.Id,
                Issuer = "https://id.example.test",
                Subject = "jo-at-provider",
                ProviderId = "work",
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var show = await fixture.RunAsync("--json", "security", "show", "jo");
        using (var json = JsonDocument.Parse(show.Output))
        {
            var identity = json.RootElement.GetProperty("data").GetProperty("identities").EnumerateArray().Single();
            Assert.Equal(identityId.ToString(), identity.GetProperty("id").GetString());
            Assert.Equal("https://id.example.test", identity.GetProperty("issuer").GetString());
            Assert.Equal("work", identity.GetProperty("providerId").GetString());
        }

        var unknown = await fixture.RunAsync("--json", "security", "unlink", "jo", Guid.NewGuid().ToString(), "--yes");
        var unlink = await fixture.RunAsync("--json", "security", "unlink", "jo", identityId.ToString(), "--yes");

        Assert.NotEqual(0, unknown.ExitCode);
        Assert.Equal(0, unlink.ExitCode);
        await using var check = fixture.OpenDb();
        Assert.False(await check.ExternalIdentities.AnyAsync(x => x.Id == identityId));
        Assert.True(await check.SecurityEvents.AnyAsync(x => x.Kind == SecurityEventKinds.IdentityUnlinked));
        Assert.True(await check.OperatorAuditEntries.AnyAsync(x => x.Operation == "security.unlink"));
    }

    [Fact]
    public async Task ConfigListsTheIdentityProvidersWithoutTheirSecrets()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();
        var environment = new Dictionary<string, string?>
        {
            ["Oidc__Providers__work__Authority"] = "https://work.example.test",
            ["Oidc__Providers__work__ClientSecret"] = "work-secret-value",
            ["Oidc__Providers__work__TrustProviderMfa"] = "true",
            ["Oidc__Providers__lab__Authority"] = "https://lab.example.test",
            ["STELLARR_OIDC_TRUST_PROVIDER_MFA"] = "false",
            ["Oidc__TrustProviderMfa"] = "false",
        };

        var providers = await fixture.RunWithEnvironmentAsync(environment, "--json", "config", "get", "oidc.providers");
        var trust = await fixture.RunWithEnvironmentAsync(environment, "--json", "config", "get", "oidc.trust-provider-mfa");
        var amr = await fixture.RunAsync("--json", "config", "get", "oidc.provider-mfa-amr");

        using (var json = JsonDocument.Parse(providers.Output))
        {
            var data = json.RootElement.GetProperty("data");
            Assert.Equal("lab, work (trusts provider MFA)", data.GetProperty("value").GetString());
            Assert.Equal("environment", data.GetProperty("source").GetString());
        }

        Assert.DoesNotContain("work-secret-value", providers.Output, StringComparison.Ordinal);
        using (var json = JsonDocument.Parse(trust.Output))
        {
            Assert.Equal("false", json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }

        using (var json = JsonDocument.Parse(amr.Output))
        {
            Assert.Equal("mfa", json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }
    }

    [Fact]
    public async Task DisabledAccountsCannotBeRecovered()
    {
        using var fixture = await CliFixture.StartAsync();
        await using (var setup = fixture.Factory.Services.CreateAsyncScope())
        {
            var setupDb = setup.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await setupDb.Users.SingleAsync(x => x.Username == "jo");
            user.IsDisabled = true;
            await setupDb.SaveChangesAsync();
        }
        fixture.Stop();

        var recover = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "lost phone", "--yes");
        Assert.Equal(4, recover.ExitCode);
        using var json = JsonDocument.Parse(recover.Output);
        Assert.Equal("account_disabled", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        await using var db = fixture.OpenDb();
        Assert.Empty(await db.CliRecoveryCredentials.ToArrayAsync());
    }

    [Fact]
    public async Task ResetLoadedBeforePromptCannotReuseAnOlderSecurityVersion()
    {
        using var fixture = await CliFixture.StartAsync();
        int version;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            version = (await db.Users.SingleAsync(x => x.Username == "jo")).SessionVersion;
        }

        using var prompt = new BlockingTextReader();
        var first = Task.Run(() => RunWithReaderAsync(
            fixture, prompt, "--json", "security", "recover", "jo", "--reason", "first reset"));
        await prompt.WaitUntilReadingAsync();

        var second = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "second reset", "--yes");
        Assert.Equal(0, second.ExitCode);
        string secondCredential;
        using (var json = JsonDocument.Parse(second.Output))
        {
            secondCredential = json.RootElement.GetProperty("data").GetProperty("recoveryCredential").GetString()!;
        }

        using var pendingClient = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var secondRedeem = await pendingClient.PostAsJsonAsync(
            "/api/auth/recovery/redeem", new { credential = secondCredential });
        secondRedeem.EnsureSuccessStatusCode();
        var secondChallenge = await secondRedeem.Content.ReadFromJsonAsync<JsonElement>();
        var secondChallengeId = secondChallenge.GetProperty("challengeId").GetString()!;
        var secondStart = await pendingClient.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start", new { challengeId = secondChallengeId });
        secondStart.EnsureSuccessStatusCode();
        var secondMethod = await secondStart.Content.ReadFromJsonAsync<JsonElement>();

        prompt.Release("yes");
        var firstRun = await first;
        Assert.True(firstRun.ExitCode == 0, firstRun.Output + firstRun.Error);
        string firstCredential;
        using (var json = JsonDocument.Parse(firstRun.Output))
        {
            firstCredential = json.RootElement.GetProperty("data").GetProperty("recoveryCredential").GetString()!;
        }
        await using (var afterReset = fixture.OpenDb())
        {
            Assert.Equal(version + 2, (await afterReset.Users.SingleAsync(x => x.Username == "jo")).SessionVersion);
        }

        var staleConfirm = await pendingClient.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId = secondChallengeId,
                methodId = secondMethod.GetProperty("methodId").GetString(),
                code = "000000",
                name = "stale",
            });
        Assert.Equal(HttpStatusCode.Unauthorized, staleConfirm.StatusCode);
        var oldCredential = await fixture.Factory.CreateClient().PostAsJsonAsync(
            "/api/auth/recovery/redeem", new { credential = secondCredential });
        Assert.Equal(HttpStatusCode.BadRequest, oldCredential.StatusCode);

        using var freshClient = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var freshRedeem = await freshClient.PostAsJsonAsync(
            "/api/auth/recovery/redeem", new { credential = firstCredential });
        freshRedeem.EnsureSuccessStatusCode();
        var freshChallenge = await freshRedeem.Content.ReadFromJsonAsync<JsonElement>();
        var freshChallengeId = freshChallenge.GetProperty("challengeId").GetString()!;
        var freshStart = await freshClient.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/start", new { challengeId = freshChallengeId });
        freshStart.EnsureSuccessStatusCode();
        var freshMethod = await freshStart.Content.ReadFromJsonAsync<JsonElement>();
        var freshSecret = freshMethod.GetProperty("secret").GetString()!;
        var freshConfirm = await freshClient.PostAsJsonAsync(
            "/api/auth/mfa/enroll/totp/confirm",
            new
            {
                challengeId = freshChallengeId,
                methodId = freshMethod.GetProperty("methodId").GetString(),
                code = Stellarr.Api.Auth.Security.TotpService.ComputeAt(freshSecret, DateTime.UtcNow),
                name = "replacement",
            });
        freshConfirm.EnsureSuccessStatusCode();

        await using var check = fixture.OpenDb();
        var stored = await check.Users.SingleAsync(x => x.Username == "jo");
        Assert.Equal(version + 3, stored.SessionVersion);
        Assert.False(stored.SecurityRecoveryRequired);
    }

    [Fact]
    public async Task DisablingWhileThePromptWaitsMakesTheRecoveryFail()
    {
        using var fixture = await CliFixture.StartAsync();
        int version;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            version = (await db.Users.SingleAsync(x => x.Username == "jo")).SessionVersion;
        }

        using var prompt = new BlockingTextReader();
        var run = Task.Run(() => RunWithReaderAsync(
            fixture, prompt, "--json", "security", "recover", "jo", "--reason", "blocked reset"));
        await prompt.WaitUntilReadingAsync();

        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            user.IsDisabled = true;
            await db.SaveChangesAsync();
        }

        prompt.Release("yes");
        var result = await run;
        Assert.Equal(4, result.ExitCode);
        using var json = JsonDocument.Parse(result.Output);
        Assert.Equal("account_disabled", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        await using var check = fixture.OpenDb();
        var stored = await check.Users.SingleAsync(x => x.Username == "jo");
        Assert.Equal(version, stored.SessionVersion);
        Assert.False(stored.SecurityRecoveryRequired);
        Assert.Empty(await check.CliRecoveryCredentials.ToArrayAsync());
    }

    [Fact]
    public async Task RecoveryBlocksPrimaryFlowsAndCredentialsAreExpiryAndVersionBound()
    {
        using var fixture = await CliFixture.StartAsync();
        var first = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "first reset", "--yes");
        Assert.Equal(0, first.ExitCode);
        var firstCredential = Credential(first);

        using var passwordClient = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var blocked = await passwordClient.PostAsJsonAsync(
            "/api/auth/login", new { username = "jo", password = "Corona!2026" });
        blocked.EnsureSuccessStatusCode();
        Assert.Equal(
            "security_recovery_required",
            (await blocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null,
            (await passwordClient.GetFromJsonAsync<JsonElement>("/api/session")).GetProperty("user").ValueKind);

        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var server = await db.Servers.OrderBy(x => x.CreatedAt).FirstAsync();
            var settings = await Stellarr.Api.Operations.InstanceSettingsService.LoadAsync(
                db, server,
                scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>(),
                CancellationToken.None);
            settings.MfaRequirement = MfaRequirements.Everyone;
            settings.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        var stillBlocked = await passwordClient.PostAsJsonAsync(
            "/api/auth/login", new { username = "jo", password = "Corona!2026" });
        stillBlocked.EnsureSuccessStatusCode();
        Assert.Equal(
            "security_recovery_required",
            (await stillBlocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());

        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var credential = await db.CliRecoveryCredentials.SingleAsync();
            credential.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await passwordClient.PostAsJsonAsync("/api/auth/recovery/redeem", new { credential = firstCredential }))
                .StatusCode);

        var second = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "second reset", "--yes");
        Assert.Equal(0, second.ExitCode);
        var secondCredential = Credential(second);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(x => x.Username == "jo").ExecuteUpdateAsync(
                setters => setters.SetProperty(x => x.SessionVersion, x => x.SessionVersion + 1));
        }
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await passwordClient.PostAsJsonAsync("/api/auth/recovery/redeem", new { credential = secondCredential }))
                .StatusCode);

        var third = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "third reset", "--yes");
        Assert.Equal(0, third.ExitCode);
        var thirdCredential = Credential(third);
        var redeemed = await passwordClient.PostAsJsonAsync(
            "/api/auth/recovery/redeem", new { credential = thirdCredential });
        redeemed.EnsureSuccessStatusCode();
        Assert.Equal(
            "mfa_enrollment_required",
            (await redeemed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        await using var check = fixture.OpenDb();
        Assert.True((await check.Users.SingleAsync(x => x.Username == "jo")).SecurityRecoveryRequired);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await passwordClient.PostAsJsonAsync("/api/auth/recovery/redeem", new { credential = thirdCredential }))
                .StatusCode);
    }

    [Fact]
    public async Task SecondResetInvalidatesPendingEmailConfirmationToo()
    {
        using var fixture = await CliFixture.StartAsync();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            user.Email = "jo@example.test";
            user.NormalizedEmail = "JO@EXAMPLE.TEST";
            await db.SaveChangesAsync();
        }

        using var prompt = new BlockingTextReader();
        var first = Task.Run(() => RunWithReaderAsync(
            fixture, prompt, "--json", "security", "recover", "jo", "--reason", "first email reset"));
        await prompt.WaitUntilReadingAsync();

        var second = await fixture.RunAsync(
            "--json", "security", "recover", "jo", "--reason", "second email reset", "--yes");
        Assert.Equal(0, second.ExitCode);
        using var client = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var redeem = await client.PostAsJsonAsync(
            "/api/auth/recovery/redeem", new { credential = Credential(second) });
        redeem.EnsureSuccessStatusCode();
        var challenge = await redeem.Content.ReadFromJsonAsync<JsonElement>();
        var challengeId = challenge.GetProperty("challengeId").GetString()!;
        var send = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/start", new { challengeId });
        send.EnsureSuccessStatusCode();
        var messages = fixture.Factory.EmailDelivery.Messages;
        var code = System.Text.RegularExpressions.Regex.Match(
            messages[messages.Count - 1].Text, @"\b\d{6}\b").Value;

        prompt.Release("yes");
        var firstRun = await first;
        Assert.True(firstRun.ExitCode == 0, firstRun.Output + firstRun.Error);

        var stale = await client.PostAsJsonAsync(
            "/api/auth/mfa/enroll/email/confirm",
            new { challengeId, code, name = "stale" });
        Assert.Equal(HttpStatusCode.Unauthorized, stale.StatusCode);
        await using var check = fixture.OpenDb();
        Assert.False(await check.MfaMethods.AnyAsync(x => x.User.Username == "jo" && x.RevokedAt == null));
    }

    private static string Credential(CliRun run)
    {
        using var json = JsonDocument.Parse(run.Output);
        return json.RootElement.GetProperty("data").GetProperty("recoveryCredential").GetString()!;
    }

    private static async Task<CliRun> RunWithReaderAsync(
        CliFixture fixture,
        TextReader input,
        params string[] args)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();
        var withRoot = new[] { "--data-root", fixture.Root }.Concat(args).ToArray();
        var exit = await Stellarr.Cli.CliApplication.RunAsync(
            withRoot,
            input,
            output,
            error,
            interactive: true,
            secretPrompt: null,
            CancellationToken.None);
        return new CliRun(exit, output.ToString(), error.ToString());
    }

    private sealed class BlockingTextReader : TextReader
    {
        private readonly TaskCompletionSource _reading = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource<string?> _answer = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task WaitUntilReadingAsync() => _reading.Task;

        public void Release(string answer) => _answer.TrySetResult($"{answer}\n");

        public override string? ReadLine()
        {
            _reading.TrySetResult();
            return _answer.Task.GetAwaiter().GetResult();
        }
    }
}
