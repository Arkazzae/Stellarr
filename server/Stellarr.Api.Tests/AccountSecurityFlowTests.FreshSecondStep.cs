using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Auth;

namespace Stellarr.Api.Tests;

/// <summary>
/// Changes that could hand an account or the instance to someone else need a
/// second step from the last few minutes once the account has one; a session
/// that is merely signed in is not enough.
/// </summary>
public sealed partial class AccountSecurityFlowTests
{
    [Fact]
    public async Task PasswordChangeNeedsAFreshSecondStepOnceTheAccountHasOne()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await EnrollTotpAsync(client);
        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow.AddMinutes(-15));
        var change = new { currentPassword = Password, newPassword = "Another!Password2026" };

        using var stale = await client.PostAsJsonAsync("/api/me/password", change);
        Assert.Equal("second-step-required", (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetString());
        await using (var scope = factory.OpenScope(out var db))
        {
            var hash = await db.Users.Where(x => x.Id == account.Id).Select(x => x.PasswordHash).SingleAsync();
            Assert.True(scope.ServiceProvider.GetRequiredService<PasswordService>().Verify(Password, hash));
        }

        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow);
        using var fresh = await client.PostAsJsonAsync("/api/me/password", change);
        Assert.Equal("changed", (await fresh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetString());
    }

    [Fact]
    public async Task CockpitChangesNeedAFreshSecondStepWhenTheOwnerHasOne()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");
        Guid ownerId;
        await using (var scope = factory.OpenScope(out var db))
        {
            ownerId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync();
        }

        var settings = new Dictionary<string, object?>
        {
            ["instanceName"] = "Orbit",
            ["timeZone"] = "UTC",
            ["mailingEnabled"] = false,
            ["mailFromAddress"] = "stellarr@example.net",
            ["inviteMailEnabled"] = true,
            ["recoveryMailEnabled"] = true,
            ["alertMailEnabled"] = false,
            ["backupRetentionDays"] = 14,
            ["logRetentionDays"] = 30,
            ["orphanObjectRetentionDays"] = 1,
            ["automaticCleanupEnabled"] = true,
        };
        var securityChange = new Dictionary<string, object?>(settings) { ["trustedDeviceDays"] = 7 };

        // Without a method there is no second step to ask for.
        using (var noMethod = await owner.PutAsJsonAsync("/api/cockpit/settings", securityChange))
        {
            Assert.Equal(HttpStatusCode.OK, noMethod.StatusCode);
        }

        await AddConfirmedTotpAsync(factory, await FindUserAsync(factory, ownerId));

        using var read = await owner.GetAsync("/api/cockpit/bootstrap");
        using var general = await owner.PutAsJsonAsync("/api/cockpit/settings", settings);
        using var security = await owner.PutAsJsonAsync("/api/cockpit/settings", securityChange);
        using var download = await owner.GetAsync("/api/cockpit/backups/not-a-backup/download");
        using var secret = await owner.DeleteAsync("/api/cockpit/secrets/giphy.api-key");
        using var check = await owner.GetAsync("/api/cockpit/fresh-second-step");
        var backupPolicy = new Stellarr.Api.Backups.BackupPolicyRequest(false, 24, 15, 5, 14);
        using var backupSettings = await owner.PutAsJsonAsync("/api/cockpit/backups/settings", backupPolicy);
        using var resetBackupSettings = await owner.DeleteAsync("/api/cockpit/backups/settings");
        var cloudflare = new Stellarr.Api.Integrations.Cloudflare.CloudflareR2Request(false, "", "auto", "", "stellarr");
        using var cloudflareSettings = await owner.PutAsJsonAsync("/api/cockpit/integrations/cloudflare/r2", cloudflare);
        using var resetCloudflareSettings = await owner.DeleteAsync("/api/cockpit/integrations/cloudflare/r2");

        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(HttpStatusCode.OK, general.StatusCode);
        foreach (var refused in new[]
                 {
                     security, download, secret, check, backupSettings, resetBackupSettings,
                     cloudflareSettings, resetCloudflareSettings,
                 })
        {
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Equal(
                FreshSecondStepFilter.Code,
                (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        }

        await SetSessionMfaTimeAsync(factory, ownerId, DateTime.UtcNow);
        using var confirmed = await owner.PutAsJsonAsync("/api/cockpit/settings", securityChange);
        using var missing = await owner.GetAsync("/api/cockpit/backups/not-a-backup/download");
        using var checkAgain = await owner.GetAsync("/api/cockpit/fresh-second-step");
        using var confirmedBackupSettings = await owner.PutAsJsonAsync("/api/cockpit/backups/settings", backupPolicy);
        Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, checkAgain.StatusCode);
        Assert.Equal(HttpStatusCode.OK, confirmedBackupSettings.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, missing.StatusCode);
    }

    [Fact]
    public async Task HandingOverTheInstanceInTheAppNeedsAFreshSecondStep()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");
        Guid ownerId, adaId, instanceId, memberRoleId;
        await using (var scope = factory.OpenScope(out var db))
        {
            ownerId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync();
            adaId = await db.Users.Where(x => x.Username == "ada").Select(x => x.Id).SingleAsync();
            instanceId = await db.Servers.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).Select(x => x.Id).FirstAsync();
            memberRoleId = await db.ServerMembers
                .Where(x => x.ServerId == instanceId && x.UserId == adaId).Select(x => x.RoleId).SingleAsync();
        }

        await AddConfirmedTotpAsync(factory, await FindUserAsync(factory, ownerId));
        owner.DefaultRequestHeaders.Add("X-Stellarr-Server", instanceId.ToString());

        using var transfer = await owner.PostAsJsonAsync("/api/admin/server/transfer", new { userId = adaId });
        using var role = await owner.PatchAsJsonAsync($"/api/admin/members/{adaId}/role", new { roleId = memberRoleId });
        foreach (var refused in new[] { transfer, role })
        {
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Equal(
                FreshSecondStepFilter.Code,
                (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        }

        await using (var scope = factory.OpenScope(out var db))
        {
            var instanceOwner = await db.ServerMembers.Include(x => x.Role)
                .SingleAsync(x => x.ServerId == instanceId && x.Role.IsOwner);
            Assert.Equal(ownerId, instanceOwner.UserId);
        }

        await SetSessionMfaTimeAsync(factory, ownerId, DateTime.UtcNow);
        using var confirmed = await owner.PostAsJsonAsync("/api/admin/server/transfer", new { userId = adaId });
        Assert.Equal(HttpStatusCode.NoContent, confirmed.StatusCode);
    }

    [Fact]
    public async Task PointingAccountMailElsewhereNeedsAFreshSecondStep()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");
        Guid ownerId;
        await using (var scope = factory.OpenScope(out var db))
        {
            ownerId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync();
        }

        var settings = new Dictionary<string, object?>
        {
            ["instanceName"] = "Orbit",
            ["timeZone"] = "UTC",
            ["mailingEnabled"] = false,
            ["mailFromAddress"] = "stellarr@example.net",
            ["inviteMailEnabled"] = true,
            ["recoveryMailEnabled"] = true,
            ["alertMailEnabled"] = false,
            ["backupRetentionDays"] = 14,
            ["logRetentionDays"] = 30,
            ["orphanObjectRetentionDays"] = 1,
            ["automaticCleanupEnabled"] = true,
            ["smtpHost"] = "smtp.example.net",
            ["smtpPort"] = 587,
            ["smtpSecurity"] = "starttls",
            ["smtpUsername"] = "mailer",
        };
        // Set while the owner has no method: nothing to ask for yet.
        (await owner.PutAsJsonAsync("/api/cockpit/settings", settings)).EnsureSuccessStatusCode();
        await AddConfirmedTotpAsync(factory, await FindUserAsync(factory, ownerId));

        using var same = await owner.PutAsJsonAsync("/api/cockpit/settings", settings);
        using var elsewhere = await owner.PutAsJsonAsync(
            "/api/cockpit/settings",
            new Dictionary<string, object?>(settings) { ["smtpHost"] = "mail.attacker.example" });

        Assert.Equal(HttpStatusCode.OK, same.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, elsewhere.StatusCode);
        Assert.Equal(
            FreshSecondStepFilter.Code,
            (await elsewhere.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    private static async Task<Domain.User> FindUserAsync(StellarrWebApplicationFactory factory, Guid id)
    {
        await using var scope = factory.OpenScope(out var db);
        return await db.Users.SingleAsync(x => x.Id == id);
    }
}
