using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Stellarr.Api.Data;

namespace Stellarr.Api.Tests;

/// <summary>
/// Pinning a message to its channel.
///
/// The interesting half is again who may, and the answer is different from
/// editing: a pin is not the author's, because it puts one message above the
/// conversation for everybody who opens the channel. That makes it moderation,
/// so it takes ManageMessages — and a member without it is told 403 rather than
/// 404, because everyone who can read the channel can already see the message
/// and there is nothing to conceal by pretending otherwise.
/// </summary>
public sealed class MessagePinTests
{
    [Fact]
    public async Task ModeratorPinsAndUnpinsAndTheListFollows()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");

        var created = await SendAsync(client, "to zostaje na górze");
        var messageId = created.GetProperty("id").GetString();
        Assert.NotNull(messageId);
        // Not pinned is null, not an empty string or a zero date.
        Assert.Equal(JsonValueKind.Null, created.GetProperty("pinnedAt").ValueKind);

        var pin = await client.PutAsync($"/api/messages/{messageId}/pin", null);
        Assert.Equal(HttpStatusCode.OK, pin.StatusCode);
        var pinned = await ReadJsonAsync(pin);
        Assert.Equal(JsonValueKind.String, pinned.GetProperty("pinnedAt").ValueKind);

        var list = await ReadJsonAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/pins"));
        Assert.Contains(
            list.GetProperty("messages").EnumerateArray(),
            x => x.GetProperty("id").GetString() == messageId);

        // The pin is also on the message wherever else it is read from, so a
        // client that never opens the panel still knows to mark it.
        var history = await ReadJsonAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/messages"));
        var stored = history.GetProperty("messages")
            .EnumerateArray()
            .Single(x => x.GetProperty("id").GetString() == messageId);
        Assert.Equal(JsonValueKind.String, stored.GetProperty("pinnedAt").ValueKind);

        var unpin = await client.DeleteAsync($"/api/messages/{messageId}/pin");
        Assert.Equal(HttpStatusCode.OK, unpin.StatusCode);
        Assert.Equal(
            JsonValueKind.Null,
            (await ReadJsonAsync(unpin)).GetProperty("pinnedAt").ValueKind);

        var after = await ReadJsonAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/pins"));
        Assert.DoesNotContain(
            after.GetProperty("messages").EnumerateArray(),
            x => x.GetProperty("id").GetString() == messageId);
    }

    [Fact]
    public async Task PinningTwiceDoesNotMoveIt()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");
        var messageId = (await SendAsync(client, "raz")).GetProperty("id").GetString();

        var first = await client.PutAsync($"/api/messages/{messageId}/pin", null);
        first.EnsureSuccessStatusCode();
        var pinnedAt = (await ReadJsonAsync(first)).GetProperty("pinnedAt").GetString();

        var second = await client.PutAsync($"/api/messages/{messageId}/pin", null);
        second.EnsureSuccessStatusCode();

        // Pressing the button twice is not two pins, and the order of the list
        // is the pin time — so an idempotent call must not jump it to the top.
        Assert.Equal(pinnedAt, (await ReadJsonAsync(second)).GetProperty("pinnedAt").GetString());
    }

    [Fact]
    public async Task AMemberWithoutManageMessagesIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = CreateClient(factory);
        await LogInAsync(owner, "maja", "Aurora!2026");
        var messageId = (await SendAsync(owner, "nie do przypięcia")).GetProperty("id").GetString();

        using var member = CreateClient(factory);
        await LogInAsync(member, "jo", "Corona!2026");

        // Not 404: this message is on a channel they are reading, so hiding
        // behind "nie ma takiej" would be a lie about something they can see.
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.PutAsync($"/api/messages/{messageId}/pin", null)).StatusCode);

        await (await owner.PutAsync($"/api/messages/{messageId}/pin", null))
            .Content.ReadAsStringAsync();
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.DeleteAsync($"/api/messages/{messageId}/pin")).StatusCode);

        // Reading the list is not moderation: everyone on the channel sees the
        // same pins, which is the entire point of pinning something.
        var list = await ReadJsonAsync(
            await member.GetAsync($"/api/channels/{TestData.GeneralChannelId}/pins"));
        Assert.Contains(
            list.GetProperty("messages").EnumerateArray(),
            x => x.GetProperty("id").GetString() == messageId);
    }

    [Fact]
    public async Task AMessageThatIsNotThereIsNotFound()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.PutAsync($"/api/messages/{Guid.NewGuid()}/pin", null)).StatusCode);
    }

    [Fact]
    public async Task DeletingAPinnedMessageTakesItOffTheList()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = CreateClient(factory);
        await LogInAsync(client, "maja", "Aurora!2026");
        var messageId = (await SendAsync(client, "znika razem z pinezką"))
            .GetProperty("id").GetString();

        (await client.PutAsync($"/api/messages/{messageId}/pin", null)).EnsureSuccessStatusCode();
        (await client.DeleteAsync($"/api/messages/{messageId}")).EnsureSuccessStatusCode();

        // A row in the pinned list that opens nothing is worse than no row.
        var list = await ReadJsonAsync(
            await client.GetAsync($"/api/channels/{TestData.GeneralChannelId}/pins"));
        Assert.DoesNotContain(
            list.GetProperty("messages").EnumerateArray(),
            x => x.GetProperty("id").GetString() == messageId);
    }

    private static HttpClient CreateClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LogInAsync(HttpClient client, string username, string password)
    {
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, string content)
    {
        var response = await client.PostAsJsonAsync(
            $"/api/channels/{TestData.GeneralChannelId}/messages",
            new { content, attachmentIds = Array.Empty<Guid>() });
        response.EnsureSuccessStatusCode();
        return await ReadJsonAsync(response);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
