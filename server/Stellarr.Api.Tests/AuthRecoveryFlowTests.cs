using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed partial class AuthRecoveryFlowTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public AuthRecoveryFlowTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task UserCanRegisterAndUseEmailAsLogin()
    {
        using var client = CreateClient();
        var inviteCode = await CreateInviteCodeAsync(_factory);
        var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            username = "nowa.osoba",
            displayName = "Nowa Osoba",
            email = "nowa@example.test",
            password = "Comet!2026",
            inviteCode,
        });

        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        var account = await client.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal("nowa@example.test", account.GetProperty("email").GetString());
        Assert.Equal(JsonValueKind.Null, account.GetProperty("avatarUrl").ValueKind);
        Assert.Equal(JsonValueKind.Null, account.GetProperty("bannerUrl").ValueKind);

        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            username = "NOWA@example.test",
            password = "Comet!2026",
        });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        var duplicate = await CreateClient().PostAsJsonAsync("/api/auth/register", new
        {
            username = "inna",
            displayName = "Inna",
            email = "nowa@example.test",
            password = "Comet!2026",
            inviteCode,
        });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task ResetLinkIsOpaqueSingleUseAndRevokesOlderSessions()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"recovery-{suffix}@example.test";
        var username = $"user-{suffix}";
        using var staleSession = CreateClient();
        var inviteCode = await CreateInviteCodeAsync(_factory);
        (await staleSession.PostAsJsonAsync("/api/auth/register", new
        {
            username,
            displayName = "Test Recovery",
            email,
            password = "Before!2026",
            inviteCode,
        })).EnsureSuccessStatusCode();

        using var anonymous = CreateClient();
        var unknown = await anonymous.PostAsJsonAsync("/api/auth/password/forgot", new
        {
            email = $"unknown-{suffix}@example.test",
        });
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
        var before = _factory.EmailDelivery.Messages.Count;

        var forgot = await anonymous.PostAsJsonAsync("/api/auth/password/forgot", new { email });
        Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        var message = Assert.Single(_factory.EmailDelivery.Messages.Skip(before));
        Assert.DoesNotContain("Before!2026", message.Text, StringComparison.Ordinal);
        var token = TokenPattern().Match(message.Text).Groups[1].Value;
        Assert.NotEmpty(token);

        var reset = await anonymous.PostAsJsonAsync("/api/auth/password/reset", new
        {
            token,
            newPassword = "After!2026",
        });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        var replay = await anonymous.PostAsJsonAsync("/api/auth/password/reset", new
        {
            token,
            newPassword = "Replay!2026",
        });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);

        var stale = await staleSession.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, stale.GetProperty("user").ValueKind);

        var oldLogin = await anonymous.PostAsJsonAsync("/api/auth/login", new
        {
            username,
            password = "Before!2026",
        });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);
        var newLogin = await anonymous.PostAsJsonAsync("/api/auth/login", new
        {
            username,
            password = "After!2026",
        });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    [Fact]
    public async Task MailTimeoutReturnsAcceptedAndKeepsPreviousResetLinkValid()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var email = $"timeout-{suffix}@example.test";
        var inviteCode = await CreateInviteCodeAsync(factory);
        (await client.PostAsJsonAsync("/api/auth/register", new
        {
            username = $"timeout-{suffix}",
            displayName = "Mail Timeout",
            email,
            password = "Before!2026",
            inviteCode,
        })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/auth/password/forgot", new { email }))
            .EnsureSuccessStatusCode();

        Guid previousTokenId;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            previousTokenId = await db.PasswordResetTokens
                .OrderByDescending(x => x.CreatedAt)
                .Select(x => x.Id)
                .FirstAsync();
        }
        factory.EmailDelivery.Failure = new TaskCanceledException("provider timeout");

        var response = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await using var verificationScope = factory.Services.CreateAsyncScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Null((await verificationDb.PasswordResetTokens.FindAsync(previousTokenId))!.UsedAt);
    }

    private HttpClient CreateClient() => _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
    });

    private static async Task<string> CreateInviteCodeAsync(
        StellarrWebApplicationFactory factory)
    {
        using var owner = factory.CreateClient(
            new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = true,
            });
        (await owner.PostAsJsonAsync(
            "/api/auth/login",
            new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
        var response = await owner.PostAsync("/api/admin/invites", null);
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var url = payload.RootElement.GetProperty("url").GetString()!;
        return url[(url.LastIndexOf('/') + 1)..];
    }

    [GeneratedRegex(@"reset-hasla\?token=([^\s]+)")]
    private static partial Regex TokenPattern();
}
