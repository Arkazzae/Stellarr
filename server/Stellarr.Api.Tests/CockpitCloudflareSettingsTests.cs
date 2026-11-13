using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Stellarr.Api.Backups;
using Stellarr.Api.Data;
using Stellarr.Api.Integrations.Cloudflare;

namespace Stellarr.Api.Tests;

public sealed class CockpitCloudflareSettingsTests
{
    private static CloudflareR2Request Settings => new(false, "", "auto", "", "stellarr");

    [Fact]
    public async Task OwnerCanSaveReloadAndResetTheR2ConnectionWithoutRestarting()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var before = await owner.GetFromJsonAsync<CloudflareR2Dto>("/api/cockpit/integrations/cloudflare/r2");
        Assert.Equal("environment", before!.Source);

        var saved = await owner.PutAsJsonAsync("/api/cockpit/integrations/cloudflare/r2", Settings with
        {
            Endpoint = "https://account.r2.cloudflarestorage.com", Bucket = "private-backups", Prefix = "instance/backups",
        });
        saved.EnsureSuccessStatusCode();
        var settings = await saved.Content.ReadFromJsonAsync<CloudflareR2Dto>();
        Assert.Equal("panel", settings!.Source);
        Assert.Equal("private-backups", settings.Bucket);

        var reloaded = new CloudflareR2PolicyStore(factory.Services.GetRequiredService<IOptions<CloudflareR2Options>>(),
            factory.Services.GetRequiredService<IDataProtectionProvider>(), factory.Services.GetRequiredService<IServiceScopeFactory>());
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await reloaded.LoadAsync(db, default);
            Assert.Equal("private-backups", reloaded.Current.Bucket);
            var row = await db.InstanceSecrets.AsNoTracking().SingleAsync(x => x.Name == "cloudflare.r2.policy");
            Assert.DoesNotContain("private-backups", row.ProtectedValue, StringComparison.Ordinal);
        }

        var reset = await owner.DeleteAsync("/api/cockpit/integrations/cloudflare/r2");
        reset.EnsureSuccessStatusCode();
        Assert.Equal("environment", (await reset.Content.ReadFromJsonAsync<CloudflareR2Dto>())!.Source);
    }

    [Fact]
    public async Task CredentialsAreWriteOnlyEncryptedAndResolvedAtRuntime()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        (await owner.PutAsJsonAsync("/api/cockpit/secrets/cloudflare.r2.access-key", new { value = "r2-private-access" })).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/cockpit/secrets/cloudflare.r2.secret-key", new { value = "r2-private-secret" })).EnsureSuccessStatusCode();
        var response = await owner.PutAsJsonAsync("/api/cockpit/integrations/cloudflare/r2", Settings with
        {
            Enabled = true, Endpoint = "https://account.r2.cloudflarestorage.com", Bucket = "private-backups",
        });
        response.EnsureSuccessStatusCode();
        var settings = await owner.GetStringAsync("/api/cockpit/integrations/cloudflare/r2");
        var listed = await owner.GetStringAsync("/api/cockpit/secrets");
        Assert.DoesNotContain("r2-private-access", settings + listed, StringComparison.Ordinal);
        Assert.DoesNotContain("r2-private-secret", settings + listed, StringComparison.Ordinal);
        var policies = factory.Services.GetRequiredService<CloudflareR2PolicyStore>();
        Assert.Equal("r2-private-secret", (await policies.ResolveAsync(default)).SecretKey);
        Assert.True(factory.Services.GetRequiredService<AutomaticBackupWorker>().Status.RemoteEnabled);
        (await owner.PutAsJsonAsync("/api/cockpit/secrets/cloudflare.r2.secret-key", new { value = "rotated" })).EnsureSuccessStatusCode();
        Assert.Equal("rotated", (await policies.ResolveAsync(default)).SecretKey);
        await using var scope = factory.Services.CreateAsyncScope();
        var rows = await scope.ServiceProvider.GetRequiredService<AppDbContext>().InstanceSecrets.AsNoTracking().ToListAsync();
        Assert.All(rows, row => Assert.DoesNotContain("r2-private", row.ProtectedValue, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(true, "http://insecure.example", "bucket")]
    [InlineData(true, "https://account.r2.cloudflarestorage.com", "")]
    public async Task InvalidSettingsDoNotReplaceTheRunningSettings(bool enabled, string endpoint, string bucket)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        if (enabled)
        {
            (await owner.PutAsJsonAsync("/api/cockpit/secrets/cloudflare.r2.access-key", new { value = "key" })).EnsureSuccessStatusCode();
            (await owner.PutAsJsonAsync("/api/cockpit/secrets/cloudflare.r2.secret-key", new { value = "secret" })).EnsureSuccessStatusCode();
        }
        var response = await owner.PutAsJsonAsync("/api/cockpit/integrations/cloudflare/r2",
            Settings with { Enabled = enabled, Endpoint = endpoint, Bucket = bucket });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("environment", factory.Services.GetRequiredService<CloudflareR2PolicyStore>().Source);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    public async Task OnlyTheInstanceOwnerCanConfigureTheR2Connection(string method)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient();
        async Task<HttpResponseMessage> SendAsync() => await client.SendAsync(new HttpRequestMessage(
            new HttpMethod(method), "/api/cockpit/integrations/cloudflare/r2")
        {
            Content = method == "PUT" ? JsonContent.Create(Settings) : null,
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
