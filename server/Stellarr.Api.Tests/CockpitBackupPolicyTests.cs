using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Stellarr.Api.Backups;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class CockpitBackupPolicyTests
{
    private static BackupPolicyRequest Policy => new(true, 12, 10, 1440, false, "", "auto", "", "stellarr", 30);

    [Fact]
    public async Task OwnerCanSaveReloadAndResetThePolicyWithoutRestarting()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var before = await owner.GetFromJsonAsync<BackupPolicyDto>("/api/cockpit/backups/settings");
        Assert.Equal("environment", before!.Source);

        var saved = await owner.PutAsJsonAsync("/api/cockpit/backups/settings", Policy);
        saved.EnsureSuccessStatusCode();
        var policy = await saved.Content.ReadFromJsonAsync<BackupPolicyDto>();
        Assert.Equal("panel", policy!.Source);
        Assert.Equal(30, policy.RetentionDays);
        Assert.Equal(12, factory.Services.GetRequiredService<AutomaticBackupWorker>().Status.IntervalHours);
        Assert.True(factory.Services.GetRequiredService<AutomaticBackupWorker>().Status.Enabled);

        var reloaded = new BackupPolicyStore(factory.Services.GetRequiredService<IOptions<AutomaticBackupOptions>>(),
            factory.Services.GetRequiredService<IDataProtectionProvider>(), factory.Services.GetRequiredService<IServiceScopeFactory>());
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await reloaded.LoadAsync(db, default);
            Assert.Equal(12, reloaded.Current.IntervalHours);
            var row = await db.InstanceSecrets.AsNoTracking().SingleAsync(x => x.Name == "backups.policy");
            Assert.DoesNotContain("IntervalHours", row.ProtectedValue, StringComparison.Ordinal);
            Assert.Equal(30, (await db.OperationsSettings.AsNoTracking().SingleAsync()).BackupRetentionDays);
        }
        var reset = await owner.DeleteAsync("/api/cockpit/backups/settings");
        reset.EnsureSuccessStatusCode();
        Assert.Equal("environment", (await reset.Content.ReadFromJsonAsync<BackupPolicyDto>())!.Source);
        Assert.False(factory.Services.GetRequiredService<AutomaticBackupWorker>().Status.Enabled);
    }

    [Fact]
    public async Task RemoteCredentialsAreWriteOnlyEncryptedAndResolvedAtRuntime()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        (await owner.PutAsJsonAsync("/api/cockpit/secrets/backups.access-key", new { value = "r2-private-access" })).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/cockpit/secrets/backups.secret-key", new { value = "r2-private-secret" })).EnsureSuccessStatusCode();
        var response = await owner.PutAsJsonAsync("/api/cockpit/backups/settings", Policy with
        {
            RemoteEnabled = true, Endpoint = "https://account.r2.cloudflarestorage.com", Bucket = "private-backups",
        });
        response.EnsureSuccessStatusCode();
        var settings = await owner.GetStringAsync("/api/cockpit/backups/settings");
        var listed = await owner.GetStringAsync("/api/cockpit/secrets");
        Assert.DoesNotContain("r2-private-access", settings + listed, StringComparison.Ordinal);
        Assert.DoesNotContain("r2-private-secret", settings + listed, StringComparison.Ordinal);
        var policies = factory.Services.GetRequiredService<BackupPolicyStore>();
        Assert.Equal("r2-private-secret", (await policies.ResolveAsync(default)).Destination.SecretKey);
        (await owner.PutAsJsonAsync("/api/cockpit/secrets/backups.secret-key", new { value = "rotated" })).EnsureSuccessStatusCode();
        Assert.Equal("rotated", (await policies.ResolveAsync(default)).Destination.SecretKey);
        await using var scope = factory.Services.CreateAsyncScope();
        var rows = await scope.ServiceProvider.GetRequiredService<AppDbContext>().InstanceSecrets.AsNoTracking().ToListAsync();
        Assert.All(rows, row => Assert.DoesNotContain("r2-private", row.ProtectedValue, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(0, 30, false, "")]
    [InlineData(12, 0, false, "")]
    [InlineData(12, 30, true, "http://insecure.example")]
    [InlineData(12, 30, true, "https://account.r2.cloudflarestorage.com")]
    public async Task InvalidPoliciesDoNotReplaceTheRunningPolicy(int interval, int retention, bool remote, string endpoint)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var response = await owner.PutAsJsonAsync("/api/cockpit/backups/settings", Policy with
        {
            IntervalHours = interval, RetentionDays = retention, RemoteEnabled = remote, Endpoint = endpoint, Bucket = "bucket",
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("environment", factory.Services.GetRequiredService<BackupPolicyStore>().Source);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    public async Task OnlyTheInstanceOwnerCanConfigureBackups(string method)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        async Task<HttpResponseMessage> SendAsync() => await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), "/api/cockpit/backups/settings")
        {
            Content = method == "PUT" ? JsonContent.Create(Policy) : null,
        });
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync()).StatusCode);
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "jo", password = "Corona!2026" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync()).StatusCode);
    }

    private static async Task<HttpClient> OwnerAsync(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient();
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" })).EnsureSuccessStatusCode();
        return client;
    }
}
