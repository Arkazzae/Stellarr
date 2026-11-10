using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class OpsFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public OpsFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public void DesktopSessionMetadataIsParsedForOps()
    {
        var desktop = Endpoints.OpsEndpoints.DescribeClient(
            "StellarrDesktop/0.4.2 CEF/150.0.10 Package/AppImage");
        Assert.Equal("Stellarr Desktop", desktop.Name);
        Assert.Equal("0.4.2", desktop.Version);
        Assert.Equal("CEF 150.0.10", desktop.Runtime);
        Assert.Equal("AppImage", desktop.InstallType);

        var browser = Endpoints.OpsEndpoints.DescribeClient(
            "Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0.0.0");
        Assert.Null(browser.Name);
        Assert.Null(browser.Version);
    }

    [Fact]
    public async Task OperationsEndpointsRequireTheInstanceOwner()
    {
        using var anonymous = Client();
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync("/api/ops/bootstrap")).StatusCode);

        using var member = Client();
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.GetAsync("/api/ops/bootstrap")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.GetAsync("/api/ops/settings")).StatusCode);

        var created = await member.PostAsJsonAsync("/api/servers", new
        {
            name = $"Untrusted owner {Guid.NewGuid():N}",
            description = "must not administer the instance",
            isPublic = false,
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.GetAsync("/api/ops/bootstrap")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.PostAsync("/api/ops/backups", null)).StatusCode);
    }

    [Fact]
    public async Task OwnerReadsRealOverviewUsersAndRoles()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var bootstrap = await JsonAsync(await owner.GetAsync("/api/ops/bootstrap"));
        Assert.Equal("maja", bootstrap.GetProperty("operator").GetProperty("username").GetString());
        Assert.True(bootstrap.GetProperty("overview").GetProperty("messageCount").GetInt32() > 0);

        var users = await JsonAsync(await owner.GetAsync("/api/ops/users"));
        Assert.Equal(
            users.GetProperty("users").GetArrayLength(),
            bootstrap.GetProperty("overview").GetProperty("userCount").GetInt32());
        Assert.Contains(
            users.GetProperty("roles").EnumerateArray(),
            role => role.GetProperty("isOwner").GetBoolean() &&
                role.GetProperty("memberCount").GetInt32() == 1);
        Assert.True(users.GetProperty("sessionRegistryAvailable").GetBoolean());
        var ownerId = users.GetProperty("users").EnumerateArray()
            .Single(user => user.GetProperty("username").GetString() == "maja")
            .GetProperty("id").GetString();

        var sessions = await JsonAsync(await owner.GetAsync("/api/ops/sessions"));
        Assert.Contains(
            sessions.EnumerateArray(),
            session => session.GetProperty("userId").GetString() == ownerId &&
                session.GetProperty("current").GetBoolean());
    }

    [Fact]
    public async Task OwnerValidatesAndPersistsNonSecretSettings()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var invalid = await owner.PutAsJsonAsync("/api/ops/settings", new
        {
            instanceName = "Orbit",
            publicUrl = "http://example.com",
            timeZone = "UTC",
            mailingEnabled = true,
            mailFromAddress = "not-an-address",
            inviteMailEnabled = true,
            recoveryMailEnabled = true,
            alertMailEnabled = false,
            backupRetentionDays = 0,
            logRetentionDays = 30,
            orphanObjectRetentionDays = 30,
            automaticCleanupEnabled = true,
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var update = await owner.PutAsJsonAsync("/api/ops/settings", new
        {
            instanceName = "Orbit Ops",
            publicUrl = "http://localhost:3001",
            timeZone = "UTC",
            mailingEnabled = false,
            mailFromAddress = "stellarr@example.net",
            inviteMailEnabled = true,
            recoveryMailEnabled = true,
            alertMailEnabled = true,
            backupRetentionDays = 21,
            logRetentionDays = 45,
            orphanObjectRetentionDays = 60,
            automaticCleanupEnabled = true,
        });
        update.EnsureSuccessStatusCode();
        var saved = await JsonAsync(update);
        Assert.Equal("Orbit Ops", saved.GetProperty("instanceName").GetString());
        Assert.Equal(21, saved.GetProperty("backupRetentionDays").GetInt32());
        Assert.True(saved.GetProperty("resendApiKeyConfigured").GetBoolean());
        Assert.Equal("resend", saved.GetProperty("mailProvider").GetString());

        var reread = await JsonAsync(await owner.GetAsync("/api/ops/settings"));
        Assert.Equal("http://localhost:3001", reread.GetProperty("publicUrl").GetString());
        Assert.Equal(45, reread.GetProperty("logRetentionDays").GetInt32());
    }

    [Fact]
    public async Task OwnerCanTestResendAndDisableARegularAccount()
    {
        using var owner = Client();
        await LoginAsync(owner, "maja", "Aurora!2026");

        var settings = await owner.PutAsJsonAsync("/api/ops/settings", new
        {
            instanceName = "Orbit",
            publicUrl = "http://localhost:3000",
            timeZone = "UTC",
            mailingEnabled = true,
            mailFromAddress = "onboarding@resend.dev",
            inviteMailEnabled = true,
            recoveryMailEnabled = true,
            alertMailEnabled = false,
            backupRetentionDays = 14,
            logRetentionDays = 30,
            orphanObjectRetentionDays = 30,
            automaticCleanupEnabled = true,
        });
        settings.EnsureSuccessStatusCode();

        var test = await owner.PostAsJsonAsync("/api/ops/mail/test", new
        {
            to = "delivered+ops@resend.dev",
        });
        test.EnsureSuccessStatusCode();
        Assert.StartsWith("email-", (await JsonAsync(test)).GetProperty("id").GetString()!);

        var users = await JsonAsync(await owner.GetAsync("/api/ops/users"));
        var jo = users.GetProperty("users").EnumerateArray()
            .Single(user => user.GetProperty("username").GetString() == "jo");
        var joId = jo.GetProperty("id").GetString();
        (await owner.PatchAsJsonAsync($"/api/ops/users/{joId}/status", new { disabled = true }))
            .EnsureSuccessStatusCode();

        using var joClient = Client();
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await joClient.PostAsJsonAsync("/api/auth/login", new
            {
                username = "jo",
                password = "Corona!2026",
            })).StatusCode);

        (await owner.PatchAsJsonAsync($"/api/ops/users/{joId}/status", new { disabled = false }))
            .EnsureSuccessStatusCode();
    }

    private HttpClient Client() => _factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
