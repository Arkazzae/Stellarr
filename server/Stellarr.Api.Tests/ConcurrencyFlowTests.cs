using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

public sealed class ConcurrencyFlowTests
{
    [Fact]
    public async Task ConcurrentFirstRegistrationsCreateOneServerAndOneOwner()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: false);
        using var first = Client(factory);
        using var second = Client(factory);

        var responses = await Task.WhenAll(
            first.PostAsJsonAsync("/api/auth/register", new
            {
                username = "first-owner",
                displayName = "First Owner",
                email = "first-owner@example.test",
                password = "Nebula!2026",
            }),
            second.PostAsJsonAsync("/api/auth/register", new
            {
                username = "second-member",
                displayName = "Second Member",
                email = "second-member@example.test",
                password = "Nebula!2026",
            }));

        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.BadRequest);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Servers.CountAsync());
        Assert.Equal(1, await db.ServerMembers.CountAsync());
        Assert.Equal(1, await db.ServerMembers.CountAsync(x => x.OwnerSlot == 1));
        Assert.Equal(1, await db.ServerMembers.CountAsync(x => x.Role.IsOwner));
    }

    [Fact]
    public async Task ConcurrentRegistrationReturnsValidationInsteadOfServerError()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var first = Client(factory);
        using var second = Client(factory);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var inviteCode = await CreateInviteCodeAsync(factory);
        var payload = new
        {
            username = $"race-{suffix}",
            displayName = "Race condition",
            email = $"race-{suffix}@example.test",
            password = "Nebula!2026",
            inviteCode,
        };

        var responses = await Task.WhenAll(
            first.PostAsJsonAsync("/api/auth/register", payload),
            second.PostAsJsonAsync("/api/auth/register", payload));

        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.BadRequest);
        Assert.DoesNotContain(responses, response => (int)response.StatusCode >= 500);
    }

    [Fact]
    public async Task OppositeFriendRequestsAndConversationOpenAreIdempotent()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = Client(factory);
        using var ada = Client(factory);
        await LoginAsync(maja, "maja", "Aurora!2026");
        await LoginAsync(ada, "ada", "Quasar!2026");

        var requestResponses = await Task.WhenAll(
            maja.PostAsJsonAsync("/api/social/requests", new { username = "ada" }),
            ada.PostAsJsonAsync("/api/social/requests", new { username = "maja" }));
        var requestResults = await Task.WhenAll(requestResponses.Select(ResultAsync));

        Assert.Equal(["already-sent", "sent"], requestResults.Order());
        Assert.DoesNotContain(requestResponses, response => (int)response.StatusCode >= 500);

        var majaId = await CurrentUserIdAsync(maja);
        var adaId = await CurrentUserIdAsync(ada);
        var conversationResponses = await Task.WhenAll(
            maja.PostAsJsonAsync("/api/social/conversations", new { userId = adaId }),
            ada.PostAsJsonAsync("/api/social/conversations", new { userId = majaId }));
        var conversationIds = await Task.WhenAll(conversationResponses.Select(IdAsync));

        Assert.All(conversationResponses, response => response.EnsureSuccessStatusCode());
        Assert.Single(conversationIds.Distinct(StringComparer.Ordinal));
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.FriendRequests.CountAsync());
        Assert.Equal(1, await db.DirectConversations.CountAsync());
    }

    [Fact]
    public async Task UnverifiedEmailChangesAndConcurrentRoleNameConflictsReturnClientErrors()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var maja = Client(factory);
        using var ada = Client(factory);
        await LoginAsync(maja, "maja", "Aurora!2026");
        await LoginAsync(ada, "ada", "Quasar!2026");
        var email = $"shared-{Guid.NewGuid():N}@example.test";

        var profileResponses = await Task.WhenAll(
            maja.PatchAsJsonAsync("/api/me", new { email }),
            ada.PatchAsJsonAsync("/api/me", new { email }));

        Assert.All(profileResponses, response =>
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode));
        Assert.DoesNotContain(profileResponses, response => (int)response.StatusCode >= 500);

        var rolePayload = new
        {
            name = $"Rola-{Guid.NewGuid():N}",
            color = "#7c6ff0",
            permissions = Array.Empty<string>(),
        };
        var roleResponses = await Task.WhenAll(
            maja.PostAsJsonAsync("/api/admin/roles", rolePayload),
            maja.PostAsJsonAsync("/api/admin/roles", rolePayload));

        Assert.Contains(roleResponses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Contains(roleResponses, response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.DoesNotContain(roleResponses, response => (int)response.StatusCode >= 500);
    }

    [Fact]
    public async Task ConcurrentOwnershipTransfersKeepExactlyOneOwner()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var first = Client(factory);
        using var second = Client(factory);
        await LoginAsync(first, "maja", "Aurora!2026");
        await LoginAsync(second, "maja", "Aurora!2026");

        var responses = await Task.WhenAll(
            first.PostAsJsonAsync("/api/admin/server/transfer", new
            {
                userId = Guid.Parse("30000000-0000-0000-0000-000000000002"),
            }),
            second.PostAsJsonAsync("/api/admin/server/transfer", new
            {
                userId = Guid.Parse("30000000-0000-0000-0000-000000000003"),
            }));

        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.NoContent);
        Assert.DoesNotContain(responses, response => (int)response.StatusCode >= 500);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.ServerMembers.CountAsync(x => x.OwnerSlot == 1));
        Assert.Equal(1, await db.ServerMembers.CountAsync(x => x.Role.IsOwner));
    }

    [Fact]
    public async Task ConcurrentChannelDeletesCannotRemoveLastChannelOfKind()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var first = Client(factory);
        using var second = Client(factory);
        await LoginAsync(first, "maja", "Aurora!2026");
        await LoginAsync(second, "maja", "Aurora!2026");
        (await first.DeleteAsync($"/api/admin/channels/{TestData.MemesChannelId}"))
            .EnsureSuccessStatusCode();

        var responses = await Task.WhenAll(
            first.DeleteAsync($"/api/admin/channels/{TestData.GeneralChannelId}"),
            second.DeleteAsync($"/api/admin/channels/{TestData.ProjectsChannelId}"));

        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.NoContent);
        Assert.Contains(responses, response => response.StatusCode == HttpStatusCode.Conflict);
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Channels.CountAsync(
            x => x.ServerId == TestData.ServerId && x.Kind == Stellarr.Api.Domain.ChannelKind.Text));
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
        .EnsureSuccessStatusCode();

    private static async Task<string> CreateInviteCodeAsync(
        StellarrWebApplicationFactory factory)
    {
        using var owner = Client(factory);
        await LoginAsync(owner, "maja", "Aurora!2026");
        var response = await owner.PostAsync("/api/admin/invites", null);
        response.EnsureSuccessStatusCode();
        using var payload = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var url = payload.RootElement.GetProperty("url").GetString()!;
        return url[(url.LastIndexOf('/') + 1)..];
    }

    private static async Task<string> CurrentUserIdAsync(HttpClient client)
    {
        var json = await client.GetFromJsonAsync<JsonElement>("/api/session");
        return json.GetProperty("user").GetProperty("id").GetString()!;
    }

    private static async Task<string> ResultAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("result").GetString()!;
    }

    private static async Task<string> IdAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        return json.GetProperty("id").GetString()!;
    }
}
