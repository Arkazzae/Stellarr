using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// The rules of channel administration that the flow tests leave alone: the
/// shape of an order, the names, the ranges, and the last channel of a kind.
/// </summary>
public sealed class ChannelAdministrationTests : IClassFixture<StellarrWebApplicationFactory>
{
    private readonly StellarrWebApplicationFactory _factory;

    public ChannelAdministrationTests(StellarrWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task AnOrderMustNameEveryChannelOfTheServerExactlyOnce()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var ids = await ChannelIdsAsync(owner);

        Assert.Equal(HttpStatusCode.BadRequest, (await ReorderAsync(owner, ids.Skip(1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ReorderAsync(owner, ids.Append(ids[0]))).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await ReorderAsync(owner, ids.Skip(1).Append(Guid.NewGuid()))).StatusCode);

        // Nothing of a refused order is kept.
        Assert.Equal(ids, await ChannelIdsAsync(owner));
    }

    [Fact]
    public async Task OnlyAChannelManagerMayReorderAndAFullOrderIsApplied()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        using var moderator = await SignedInAsync(_factory, "ada", "Quasar!2026");
        var ids = await ChannelIdsAsync(owner);
        var reversed = ids.AsEnumerable().Reverse().ToArray();

        Assert.Equal(HttpStatusCode.Forbidden, (await ReorderAsync(moderator, reversed)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await ReorderAsync(owner, reversed)).StatusCode);
        Assert.Equal(reversed, await ChannelIdsAsync(owner));
    }

    [Fact]
    public async Task ChannelNamesAreUniqueWithinTheServerWhateverTheirCase()
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var name = $"unique-{Guid.NewGuid():N}";

        Assert.Equal(HttpStatusCode.Created, (await CreateAsync(owner, name, "text")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await CreateAsync(owner, name.ToUpperInvariant(), "voice")).StatusCode);

        var other = await CreateAsync(owner, $"other-{Guid.NewGuid():N}", "text");
        var otherId = await IdOfAsync(other);
        var renamed = await owner.PatchAsJsonAsync($"/api/admin/channels/{otherId}", new { name });
        Assert.Equal(HttpStatusCode.Conflict, renamed.StatusCode);
    }

    [Fact]
    public async Task ANameTakenAfterTheCheckIsAConflictAndLeavesNothingPending()
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var taken = await db.Channels.Select(x => x.Name).FirstAsync();
        db.Channels.Add(new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = TestData.ServerId,
            Name = taken,
            Kind = ChannelKind.Text,
            Position = 99,
        });

        Assert.False(await db.TrySaveChangesAsync(CancellationToken.None));
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task TwoRequestsForOneNameAtOnceEndInOneChannelAndNoServerError()
    {
        using var first = await SignedInAsync(_factory, "maja", "Aurora!2026");
        using var second = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var name = $"race-{Guid.NewGuid():N}";

        var responses = await Task.WhenAll(CreateAsync(first, name, "text"), CreateAsync(second, name, "text"));

        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict);
    }

    [Theory]
    [InlineData("two words", "text")]
    [InlineData("", "text")]
    [InlineData("under_score", "text")]
    [InlineData("fine-name", "forum")]
    [InlineData("fine-name", null)]
    public async Task ANameOrKindOutsideTheRulesIsRefused(string name, string? kind)
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");

        var response = await owner.PostAsJsonAsync("/api/admin/channels", new { name, kind });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("text", "slowModeSeconds", 21601)]
    [InlineData("text", "slowModeSeconds", -1)]
    [InlineData("text", "hideAfterInactivityHours", 8761)]
    [InlineData("text", "audioProfile", "studio")]
    [InlineData("text", "userLimit", 5)]
    [InlineData("voice", "userLimit", 100)]
    [InlineData("voice", "audioProfile", "ultra")]
    [InlineData("voice", "topic", "a topic")]
    [InlineData("voice", "slowModeSeconds", 10)]
    public async Task ASettingOutOfRangeOrForTheOtherKindOfChannelIsRefused(string kind, string setting, object value)
    {
        using var owner = await SignedInAsync(_factory, "maja", "Aurora!2026");
        var channelId = await IdOfAsync(await CreateAsync(owner, $"{kind}-{Guid.NewGuid():N}", kind));

        var response = await owner.PatchAsJsonAsync(
            $"/api/admin/channels/{channelId}",
            new Dictionary<string, object> { [setting] = value });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TheLastChannelOfAKindCannotBeDeleted()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await SignedInAsync(factory, "maja", "Aurora!2026");

        foreach (var removable in new[] { TestData.MemesChannelId, TestData.ProjectsChannelId, TestData.NightShiftChannelId })
        {
            Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/admin/channels/{removable}")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/channels/{TestData.GeneralChannelId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/admin/channels/{TestData.VoiceChannelId}")).StatusCode);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Channels.CountAsync(x => x.Kind == ChannelKind.Text));
        Assert.Equal(1, await db.Channels.CountAsync(x => x.Kind == ChannelKind.Voice));
    }

    private static Task<HttpResponseMessage> ReorderAsync(HttpClient client, IEnumerable<Guid> ids) =>
        client.PutAsJsonAsync("/api/admin/channels/order", new { channelIds = ids });

    private static Task<HttpResponseMessage> CreateAsync(HttpClient client, string name, string kind) =>
        client.PostAsJsonAsync("/api/admin/channels", new { name, kind });

    private static async Task<string> IdOfAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("id").GetString()!;
    }

    private static async Task<Guid[]> ChannelIdsAsync(HttpClient client)
    {
        using var bootstrap = JsonDocument.Parse(await client.GetStringAsync("/api/bootstrap"));
        return bootstrap.RootElement.GetProperty("channels").EnumerateArray()
            .Select(x => Guid.Parse(x.GetProperty("id").GetString()!)).ToArray();
    }

    private static async Task<HttpClient> SignedInAsync(
        StellarrWebApplicationFactory factory, string username, string password)
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        return client;
    }
}
