using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>The owner's view of an account's security in Cockpit, and the recovery it can start.</summary>
public sealed class CockpitAccountSecurityTests
{
    [Fact]
    public async Task OwnerSeesAnAccountsSecurityWithoutItsSecrets()
    {
        using var factory = new StellarrWebApplicationFactory();
        var ada = await PrepareAdaAsync(factory);
        using var owner = await OwnerAsync(factory);

        using var response = await owner.GetAsync($"/api/cockpit/users/{ada.UserId}/security");

        response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync();
        var security = JsonDocument.Parse(text).RootElement;
        Assert.Equal("totp", security.GetProperty("methods")[0].GetProperty("type").GetString());
        Assert.Equal("Telefon", security.GetProperty("methods")[0].GetProperty("name").GetString());
        Assert.Equal("id.example.test", security.GetProperty("identities")[0].GetProperty("name").GetString());
        Assert.False(security.GetProperty("recoveryRequired").GetBoolean());
        Assert.DoesNotContain("protected-seed", text, StringComparison.Ordinal);

        using var stranger = await owner.GetAsync($"/api/cockpit/users/{Guid.NewGuid()}/security");
        Assert.Equal(HttpStatusCode.NotFound, stranger.StatusCode);
    }

    [Fact]
    public async Task OwnerRecoversAnotherAccountLikeTheCli()
    {
        using var factory = new StellarrWebApplicationFactory();
        var ada = await PrepareAdaAsync(factory);
        using var owner = await OwnerAsync(factory);
        Guid ownerId;
        await using (var scope = factory.OpenScope(out var db))
        {
            ownerId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync();
        }

        using var self = await owner.PostAsJsonAsync($"/api/cockpit/users/{ownerId}/security/recover", new { reason = "lost phone" });
        using var noReason = await owner.PostAsJsonAsync($"/api/cockpit/users/{ada.UserId}/security/recover", new { reason = "x" });
        using var recover = await owner.PostAsJsonAsync($"/api/cockpit/users/{ada.UserId}/security/recover", new { reason = "lost phone" });

        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        recover.EnsureSuccessStatusCode();
        var result = await recover.Content.ReadFromJsonAsync<JsonElement>();
        var credential = result.GetProperty("credential").GetString()!;
        Assert.Equal(1, result.GetProperty("methodsRevoked").GetInt32());

        await using (var scope = factory.OpenScope(out var db))
        {
            var user = await db.Users.SingleAsync(x => x.Id == ada.UserId);
            Assert.True(user.SecurityRecoveryRequired);
            Assert.NotNull((await db.MfaMethods.SingleAsync(x => x.UserId == ada.UserId)).RevokedAt);
            Assert.True(await db.ServerAuditEntries.AnyAsync(x => x.ActorId == ownerId && x.Summary.Contains("Ada")));
            // A recovery keeps the provider links.
            Assert.True(await db.ExternalIdentities.AnyAsync(x => x.UserId == ada.UserId));
        }

        // The credential works like the CLI's: it starts only the setup of a new method.
        using var visitor = factory.CreateClient();
        using var redeem = await visitor.PostAsJsonAsync("/api/auth/recovery/redeem", new { credential });
        redeem.EnsureSuccessStatusCode();
        Assert.Equal("recovery", (await redeem.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("purpose").GetString());
    }

    [Fact]
    public async Task OwnerRemovesAProviderLink()
    {
        using var factory = new StellarrWebApplicationFactory();
        var ada = await PrepareAdaAsync(factory);
        using var owner = await OwnerAsync(factory);

        using var unlink = await owner.PostAsync(
            $"/api/cockpit/users/{ada.UserId}/identities/{ada.IdentityId}/remove", content: null);

        Assert.Equal(HttpStatusCode.NoContent, unlink.StatusCode);
        await using var scope = factory.OpenScope(out var db);
        Assert.False(await db.ExternalIdentities.AnyAsync(x => x.UserId == ada.UserId));
        Assert.True(await db.SecurityEvents.AnyAsync(
            x => x.UserId == ada.UserId && x.Kind == SecurityEventKinds.IdentityUnlinked));
    }

    private sealed record Prepared(Guid UserId, Guid IdentityId);

    private static async Task<Prepared> PrepareAdaAsync(StellarrWebApplicationFactory factory)
    {
        await using var scope = factory.OpenScope(out var db);
        var ada = await db.Users.SingleAsync(x => x.Username == "ada");
        var identityId = Guid.NewGuid();
        db.MfaMethods.Add(new MfaMethod
        {
            Id = Guid.NewGuid(),
            UserId = ada.Id,
            Type = MfaMethodTypes.Totp,
            Name = "Telefon",
            ProtectedSecret = "protected-seed",
            CreatedAt = DateTime.UtcNow,
            ConfirmedAt = DateTime.UtcNow,
        });
        db.ExternalIdentities.Add(new ExternalIdentity
        {
            Id = identityId,
            UserId = ada.Id,
            Issuer = "https://id.example.test",
            Subject = "ada-at-provider",
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return new Prepared(ada.Id, identityId);
    }

    private static async Task<HttpClient> OwnerAsync(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
        return client;
    }
}
