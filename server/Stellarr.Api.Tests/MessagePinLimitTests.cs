using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

/// <summary>
/// A channel keeps at most fifty pins. The cap is a rule of the channel, so
/// it neither follows the pinned message elsewhere nor stops anybody from
/// unpinning, which is the way out the refusal points to.
/// </summary>
public sealed class MessagePinLimitTests
{
    private const int Limit = 50;

    [Fact]
    public async Task AFullChannelRefusesAnotherPinUntilOneIsRemoved()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory);
        var pinned = await PinFiftyAsync(factory, TestData.GeneralChannelId);
        var next = await SendAsync(client, TestData.GeneralChannelId, "pięćdziesiąt jeden");

        var refused = await client.PutAsync($"/api/messages/{next}/pin", null);

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        using var problem = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
        var errors = problem.RootElement.GetProperty("errors");
        Assert.Equal(
            "Kanał może mieć najwyżej 50 przypiętych wiadomości. Odepnij coś, aby zrobić miejsce.",
            Assert.Single(errors.GetProperty("pins").EnumerateArray()).GetString());
        Assert.Equal(Limit, (await ListPinsAsync(client, TestData.GeneralChannelId)).Count);

        (await client.DeleteAsync($"/api/messages/{pinned[0]}/pin")).EnsureSuccessStatusCode();
        (await client.PutAsync($"/api/messages/{next}/pin", null)).EnsureSuccessStatusCode();

        var after = await ListPinsAsync(client, TestData.GeneralChannelId);
        Assert.Equal(Limit, after.Count);
        Assert.Equal(next, after[0]);
        Assert.DoesNotContain(pinned[0], after);
    }

    [Fact]
    public async Task PinningWhatIsAlreadyPinnedStillWorksInAFullChannel()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory);
        var pinned = await PinFiftyAsync(factory, TestData.GeneralChannelId);

        var again = await client.PutAsync($"/api/messages/{pinned[0]}/pin", null);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task TheLimitBelongsToTheChannelOfThePin()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory);
        await PinFiftyAsync(factory, TestData.GeneralChannelId);
        var elsewhere = await SendAsync(client, TestData.ProjectsChannelId, "w innym kanale");

        var response = await client.PutAsync($"/api/messages/{elsewhere}/pin", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<HttpClient> SignInAsync(StellarrWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "maja", password = "Aurora!2026" }))
            .EnsureSuccessStatusCode();
        return client;
    }

    /// <summary>Stores fifty messages that are already pinned, newest pin last, and returns their ids.</summary>
    private static async Task<List<string>> PinFiftyAsync(StellarrWebApplicationFactory factory, Guid channelId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var authorId = await db.Users.Where(x => x.Username == "maja").Select(x => x.Id).SingleAsync();
        var start = DateTime.UtcNow.AddHours(-1);
        var messages = Enumerable.Range(0, Limit).Select(index => new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = channelId,
            AuthorId = authorId,
            Content = $"przypięta {index}",
            CreatedAt = start.AddSeconds(index),
            PinnedAt = start.AddSeconds(index),
        }).ToList();
        db.Messages.AddRange(messages);
        await db.SaveChangesAsync();
        return messages.Select(x => x.Id.ToString()).ToList();
    }

    private static async Task<string> SendAsync(HttpClient client, Guid channelId, string content)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/channels/{channelId}/messages",
            new { content, attachmentIds = Array.Empty<Guid>() });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;
    }

    /// <summary>The ids of the channel's pins in the order the list gives them.</summary>
    private static async Task<List<string>> ListPinsAsync(HttpClient client, Guid channelId)
    {
        var list = await client.GetFromJsonAsync<JsonElement>($"/api/channels/{channelId}/pins");
        return list.GetProperty("messages").EnumerateArray()
            .Select(x => x.GetProperty("id").GetString()!)
            .ToList();
    }
}
