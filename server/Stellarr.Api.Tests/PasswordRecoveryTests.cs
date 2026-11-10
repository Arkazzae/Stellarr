using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;

namespace Stellarr.Api.Tests;

/// <summary>
/// Somebody who forgot their password asks for a link by mail and sets a new
/// one with it. The answer to the request never says whether the address is
/// known, and a link works once.
/// </summary>
public sealed partial class PasswordRecoveryTests
{
    private const string Email = "jo@example.test";
    private const string OldPassword = "Corona!2026";
    private const string NewPassword = "Korona!2027";

    [Fact]
    public async Task AnUnknownAddressIsAnsweredLikeAKnownOneAndGetsNoMail()
    {
        using var factory = await CreateFactoryAsync();
        using var client = CreateClient(factory);

        var response = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email = "nobody@example.test" });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Empty(factory.EmailDelivery.Messages);
    }

    [Fact]
    public async Task AKnownAddressGetsOneMailWhoseLinkIsStoredOnlyAsAHash()
    {
        using var factory = await CreateFactoryAsync();
        using var client = CreateClient(factory);

        var token = await RequestLinkAsync(factory, client);

        var message = Assert.Single(factory.EmailDelivery.Messages);
        Assert.Equal(Email, message.To);
        Assert.Contains($"https://chat.test/reset-hasla?token={token}", message.Text, StringComparison.Ordinal);
        Assert.Contains($"https://chat.test/reset-hasla?token={token}", message.Html, StringComparison.Ordinal);
        await using var scope = factory.OpenScope(out var db);
        var stored = await db.PasswordResetTokens.SingleAsync();
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))), stored.TokenHash);
        Assert.Null(stored.UsedAt);
        Assert.InRange(stored.ExpiresAt - stored.CreatedAt, TimeSpan.FromMinutes(59), TimeSpan.FromMinutes(61));
    }

    [Fact]
    public async Task TheLinkSetsANewPasswordOnceAndEndsSessionsIssuedBefore()
    {
        using var factory = await CreateFactoryAsync();
        using var earlier = CreateClient(factory);
        (await earlier.PostAsJsonAsync("/api/auth/login", new { username = "jo", password = OldPassword }))
            .EnsureSuccessStatusCode();
        using var client = CreateClient(factory);
        var token = await RequestLinkAsync(factory, client);

        var reset = await client.PostAsJsonAsync("/api/auth/password/reset", new { token, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
        var replay = await client.PostAsJsonAsync("/api/auth/password/reset", new { token, newPassword = "Replay!2028" });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        var session = await earlier.GetFromJsonAsync<JsonElement>("/api/session");
        Assert.Equal(JsonValueKind.Null, session.GetProperty("user").ValueKind);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/api/auth/login", new { username = "jo", password = OldPassword })).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/api/auth/login", new { username = "jo", password = NewPassword })).StatusCode);
    }

    [Fact]
    public async Task ANewLinkRetiresTheOlderOneOnceItIsDelivered()
    {
        using var factory = await CreateFactoryAsync();
        using var client = CreateClient(factory);
        var first = await RequestLinkAsync(factory, client);
        var second = await RequestLinkAsync(factory, client);

        var older = await client.PostAsJsonAsync("/api/auth/password/reset", new { token = first, newPassword = NewPassword });
        var newer = await client.PostAsJsonAsync("/api/auth/password/reset", new { token = second, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.BadRequest, older.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, newer.StatusCode);
    }

    [Fact]
    public async Task AFailedDeliveryStillAnswersAcceptedAndKeepsThePreviousLinkValid()
    {
        using var factory = await CreateFactoryAsync();
        using var client = CreateClient(factory);
        var token = await RequestLinkAsync(factory, client);
        factory.EmailDelivery.Failure = new TaskCanceledException("provider timeout");

        var response = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Single(factory.EmailDelivery.Messages);
        var reset = await client.PostAsJsonAsync("/api/auth/password/reset", new { token, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
    }

    [Fact]
    public async Task AnExpiredLinkIsRefused()
    {
        using var factory = await CreateFactoryAsync();
        using var client = CreateClient(factory);
        var token = await RequestLinkAsync(factory, client);
        await using (var scope = factory.OpenScope(out var db))
        {
            await db.PasswordResetTokens.ExecuteUpdateAsync(
                setters => setters.SetProperty(x => x.ExpiresAt, DateTime.UtcNow.AddMinutes(-1)));
        }

        var reset = await client.PostAsJsonAsync("/api/auth/password/reset", new { token, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
    }

    [Fact]
    public async Task AResetNeedsALinkAndAnAcceptablePassword()
    {
        using var factory = await CreateFactoryAsync();
        using var client = CreateClient(factory);
        var token = await RequestLinkAsync(factory, client);

        var tooShort = await client.PostAsJsonAsync("/api/auth/password/reset", new { token, newPassword = "short" });
        var noToken = await client.PostAsJsonAsync("/api/auth/password/reset", new { token = " ", newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
        Assert.Equal(
            "Hasło musi mieć co najmniej 8 znaków.",
            ErrorOf(await ReadJsonAsync(tooShort), "newPassword"));
        Assert.Equal(HttpStatusCode.BadRequest, noToken.StatusCode);
        Assert.Equal(
            "Link do zmiany hasła jest nieprawidłowy lub wygasł.",
            ErrorOf(await ReadJsonAsync(noToken), "token"));
        // Neither attempt used the link up.
        var reset = await client.PostAsJsonAsync("/api/auth/password/reset", new { token, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
    }

    [Fact]
    public async Task NoMailGoesOutWhileRecoveryMailIsSwitchedOff()
    {
        using var factory = await CreateFactoryAsync();
        await using (var scope = factory.OpenScope(out var db))
        {
            db.OperationsSettings.Add(new OperationsSettings
            {
                ServerId = TestData.ServerId,
                MailingEnabled = true,
                RecoveryMailEnabled = false,
            });
            await db.SaveChangesAsync();
        }

        using var client = CreateClient(factory);
        var response = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Empty(factory.EmailDelivery.Messages);
        await using var verification = factory.OpenScope(out var verificationDb);
        Assert.Empty(await verificationDb.PasswordResetTokens.ToArrayAsync());
    }

    /// <summary>Asks for a link for the account's address and returns the token in the mail it was sent.</summary>
    private static async Task<string> RequestLinkAsync(StellarrWebApplicationFactory factory, HttpClient client)
    {
        var before = factory.EmailDelivery.Messages.Count;
        var response = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email = Email });
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var message = Assert.Single(factory.EmailDelivery.Messages.Skip(before));
        return TokenPattern().Match(message.Text).Groups[1].Value;
    }

    /// <summary>The seeded instance, in which Jo has an address to recover through.</summary>
    private static async Task<StellarrWebApplicationFactory> CreateFactoryAsync()
    {
        var factory = new StellarrWebApplicationFactory();
        await using var scope = factory.OpenScope(out var db);
        await db.Users
            .Where(x => x.Username == "jo")
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(x => x.Email, Email)
                .SetProperty(x => x.NormalizedEmail, Email.ToUpperInvariant()));
        return factory;
    }

    private static HttpClient CreateClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static string? ErrorOf(JsonElement problem, string field) =>
        Assert.Single(problem.GetProperty("errors").GetProperty(field).EnumerateArray()).GetString();

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    [GeneratedRegex(@"reset-hasla\?token=(\S+)")]
    private static partial Regex TokenPattern();
}
