using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>Changing the account's address: proven by the new address, told to the old one.</summary>
public sealed partial class AccountSecurityFlowTests
{
    [Fact]
    public async Task AddressChangeIsConfirmedFromTheNewAddressAndToldToTheOldOne()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "old@example.test");
        await SetEmailPolicyAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);

        Assert.Equal("sent", await ChangeEmailAsync(client, "New@Example.test", Password));
        var mail = factory.EmailDelivery.Messages[^1];
        Assert.Equal("New@Example.test", mail.To);
        var token = Uri.UnescapeDataString(Regex.Match(mail.Text, @"confirm-email\?token=(\S+)").Groups[1].Value);

        // What the old address still opens: an email method, a code and a reset link.
        await AddConfirmedEmailAsync(factory, account, "old@example.test");
        await using (var scope = factory.OpenScope(out var db))
        {
            db.PasswordResetTokens.Add(new PasswordResetToken
            {
                Id = Guid.NewGuid(),
                UserId = account.Id,
                TokenHash = "OLD-RESET-LINK",
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddHours(1),
            });
            await db.SaveChangesAsync();
        }

        // Opened on another device: the token alone proves the new address.
        using var phone = Client(factory);
        Assert.Equal("changed", await ConfirmEmailAsync(phone, token));
        Assert.Equal("invalid", await ConfirmEmailAsync(phone, token));

        await using var check = factory.OpenScope(out var checkDb);
        var user = await checkDb.Users.SingleAsync(x => x.Id == account.Id);
        Assert.Equal("New@Example.test", user.Email);
        Assert.Equal("NEW@EXAMPLE.TEST", user.NormalizedEmail);
        Assert.NotNull((await checkDb.MfaMethods.SingleAsync(x => x.UserId == account.Id)).RevokedAt);
        Assert.NotNull((await checkDb.PasswordResetTokens.SingleAsync(x => x.UserId == account.Id)).UsedAt);
        var changed = await checkDb.SecurityEvents.SingleAsync(
            x => x.UserId == account.Id && x.Kind == SecurityEventKinds.EmailChanged);
        Assert.Equal(
            "old@example.test",
            (await checkDb.SecurityNotifications.SingleAsync(x => x.SecurityEventId == changed.Id)).EmailAddress);
    }

    [Fact]
    public async Task AddressChangeNeedsThePasswordAndAFreshSecondStep()
    {
        using var factory = new StellarrWebApplicationFactory();
        var account = await CreateAccountAsync(factory, "jo@example.test");
        var other = await CreateAccountAsync(factory, "taken@example.test");
        await SetEmailPolicyAsync(factory);
        using var client = Client(factory);
        await LoginAsync(client, account.Username);
        await EnrollTotpAsync(client);
        var sentBefore = factory.EmailDelivery.Messages.Count;

        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow.AddMinutes(-15));
        Assert.Equal("second-step-required", await ChangeEmailAsync(client, "new@example.test", Password));

        await SetSessionMfaTimeAsync(factory, account.Id, DateTime.UtcNow);
        Assert.Equal("wrong-password", await ChangeEmailAsync(client, "new@example.test", "not-it"));
        Assert.Equal("same", await ChangeEmailAsync(client, "JO@example.test", Password));
        Assert.Equal("taken", await ChangeEmailAsync(client, "Taken@Example.test", Password));
        using (var invalid = await client.PostAsJsonAsync("/api/me/email", new { email = "not an address", password = Password }))
        {
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        }

        Assert.Equal(sentBefore, factory.EmailDelivery.Messages.Count);
        Assert.Equal("sent", await ChangeEmailAsync(client, "new@example.test", Password));
        Assert.Equal(sentBefore + 1, factory.EmailDelivery.Messages.Count);
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal("jo@example.test", (await db.Users.SingleAsync(x => x.Id == account.Id)).Email);
        Assert.Equal("taken@example.test", (await db.Users.SingleAsync(x => x.Id == other.Id)).Email);
    }

    [Fact]
    public async Task AddressTakenWhileTheLinkWaitedIsNotStolen()
    {
        using var factory = new StellarrWebApplicationFactory();
        var first = await CreateAccountAsync(factory, "first@example.test");
        var second = await CreateAccountAsync(factory, "second@example.test");
        await SetEmailPolicyAsync(factory);
        using var firstClient = Client(factory);
        using var secondClient = Client(factory);
        await LoginAsync(firstClient, first.Username);
        await LoginAsync(secondClient, second.Username);

        Assert.Equal("sent", await ChangeEmailAsync(firstClient, "shared@example.test", Password));
        var firstToken = LastToken(factory);
        Assert.Equal("sent", await ChangeEmailAsync(secondClient, "shared@example.test", Password));
        var secondToken = LastToken(factory);

        Assert.Equal("changed", await ConfirmEmailAsync(secondClient, secondToken));
        Assert.Equal("taken", await ConfirmEmailAsync(firstClient, firstToken));
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal("first@example.test", (await db.Users.SingleAsync(x => x.Id == first.Id)).Email);
    }

    private static async Task<string?> ChangeEmailAsync(HttpClient client, string email, string password)
    {
        using var response = await client.PostAsJsonAsync("/api/me/email", new { email, password });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetString();
    }

    private static async Task<string?> ConfirmEmailAsync(HttpClient client, string token)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/email/confirm", new { token });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("result").GetString();
    }

    private static string LastToken(StellarrWebApplicationFactory factory) =>
        Uri.UnescapeDataString(Regex.Match(
            factory.EmailDelivery.Messages[^1].Text, @"confirm-email\?token=(\S+)").Groups[1].Value);
}
