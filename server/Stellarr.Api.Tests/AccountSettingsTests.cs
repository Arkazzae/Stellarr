using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Tests;

/// <summary>
/// The rules of the account settings that the end-to-end walk in
/// <see cref="AccountFlowTests"/> does not reach.
/// </summary>
public sealed class AccountSettingsTests
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    [Fact]
    public async Task ChangingTheEmailIsRefusedAndNothingElseInTheRequestIsApplied()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");

        var response = await client.PatchAsJsonAsync("/api/me", new { displayName = "Adela", email = "adela@example.test" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await ReadJsonAsync(response)).GetProperty("errors");
        Assert.Equal(
            "Zmiana adresu odzyskiwania wymaga potwierdzenia nowego adresu i jest obecnie wyłączona.",
            Assert.Single(errors.GetProperty("email").EnumerateArray()).GetString());
        var account = await ReadJsonAsync(await client.GetAsync("/api/me"));
        Assert.Equal("Ada", account.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task EmptyProfileTextIsStoredAsNullAndAbsentFieldsAreKept()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ilya", "Meteor!2026");
        (await client.PatchAsJsonAsync("/api/me", new { bio = "Piszę", pronouns = "on/jego" })).EnsureSuccessStatusCode();

        var response = await client.PatchAsJsonAsync("/api/me", new { bio = "   " });

        response.EnsureSuccessStatusCode();
        var account = await ReadJsonAsync(response);
        Assert.Equal("", account.GetProperty("bio").GetString());
        Assert.Equal("on/jego", account.GetProperty("pronouns").GetString());
        await using var scope = factory.OpenScope(out var db);
        var user = await db.Users.SingleAsync(x => x.Username == "ilya");
        Assert.Null(user.Bio);
        Assert.Equal("on/jego", user.Pronouns);
    }

    [Fact]
    public async Task PreferencesStartFromTheDefaultsAndOnlyChangeWhatWasSent()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "nils", "Zenith!2026");

        var response = await client.PatchAsJsonAsync("/api/me/preferences", new { mentionsOnly = false });

        response.EnsureSuccessStatusCode();
        var preferences = await ReadJsonAsync(response);
        Assert.False(preferences.GetProperty("mentionsOnly").GetBoolean());
        Assert.True(preferences.GetProperty("desktopNotifications").GetBoolean());
        Assert.True(preferences.GetProperty("showPresence").GetBoolean());
        Assert.Equal(60, preferences.GetProperty("vadSensitivity").GetInt32());
        Assert.Equal(JsonValueKind.Null, preferences.GetProperty("joinSoundId").ValueKind);
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.UserPreferences.CountAsync(x => x.User.Username == "nils"));
    }

    [Fact]
    public async Task ASoundThatIsNotOnAJoinedServersSoundboardCannotAnnounceArrivals()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "jo", "Corona!2026");

        var response = await client.PatchAsJsonAsync(
            "/api/me/preferences",
            new { joinSoundId = Guid.NewGuid().ToString() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await ReadJsonAsync(response)).GetProperty("errors");
        Assert.Equal(
            "Wybierz dźwięk z soundboardu serwera, na którym jesteś.",
            Assert.Single(errors.GetProperty("joinSoundId").EnumerateArray()).GetString());
        var library = await ReadJsonAsync(await client.GetAsync("/api/me/join-sound"));
        Assert.Equal(5, library.GetProperty("maxSeconds").GetDouble());
        Assert.Equal(JsonValueKind.Null, library.GetProperty("selectedId").ValueKind);
        Assert.Equal(0, library.GetProperty("servers").GetArrayLength());
    }

    [Fact]
    public async Task HidingPresenceMakesTheAccountOfflineToOthersOnly()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "maja", "Aurora!2026");
        var majaId = Guid.Parse("30000000-0000-0000-0000-000000000001");
        var presence = factory.Services.GetRequiredService<PresenceTracker>();
        presence.Connect("connection", majaId);

        (await client.PatchAsJsonAsync("/api/me/preferences", new { showPresence = false })).EnsureSuccessStatusCode();

        Assert.Equal("online", presence.PresenceOf(majaId));
        Assert.Equal("offline", presence.PublicPresenceOf(majaId));
    }

    [Fact]
    public async Task ChangingThePasswordEndsTheOtherSessionsAndKeepsTheCurrentOne()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var current = await SignInAsync(factory, "jo", "Corona!2026");
        using var other = await SignInAsync(factory, "jo", "Corona!2026");

        var changed = await current.PostAsJsonAsync(
            "/api/me/password",
            new { currentPassword = "Corona!2026", newPassword = "Korona!2027" });

        changed.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await current.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/me")).StatusCode);
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(1, await db.UserSessions.CountAsync(x => x.User.Username == "jo" && x.RevokedAt == null));
    }

    [Fact]
    public async Task ATooLongNewPasswordIsRejectedAsInvalidInput()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");

        var response = await client.PostAsJsonAsync(
            "/api/me/password",
            new { currentPassword = "Quasar!2026", newPassword = new string('x', 257) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await ReadJsonAsync(response)).GetProperty("errors");
        Assert.Equal(
            "Nowe hasło może mieć najwyżej 256 znaków.",
            Assert.Single(errors.GetProperty("newPassword").EnumerateArray()).GetString());
    }

    [Fact]
    public async Task ReplacingAnAvatarQueuesTheOldObjectForDeletionAndKeepsTheNewOne()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "nils", "Zenith!2026");
        var first = await UploadAsync(client, "avatar");
        var firstId = Guid.Parse(first["/assets/".Length..]);
        string firstKey;
        await using (var scope = factory.OpenScope(out var db))
        {
            firstKey = await db.ImageAttachments.Where(x => x.Id == firstId).Select(x => x.ObjectKey).SingleAsync();
        }

        var second = await UploadAsync(client, "avatar");

        Assert.NotEqual(first, second);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(first)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(second)).StatusCode);
        await using var verification = factory.OpenScope(out var verificationDb);
        Assert.Contains(firstKey, await verificationDb.ObjectDeletions.Select(x => x.ObjectKey).ToArrayAsync());
    }

    [Fact]
    public async Task OnlyAvatarsAndBannersCanBeSetOrRemoved()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");

        using var form = ImageForm("image/png", Png);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/me/images/cover", form)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/me/images/cover")).StatusCode);

        using var wrongType = ImageForm("text/plain", Png);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.PostAsync("/api/me/images/banner", wrongType)).StatusCode);
        using var forged = ImageForm("image/jpeg", Png);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await client.PostAsync("/api/me/images/banner", forged)).StatusCode);
    }

    private static async Task<string> UploadAsync(HttpClient client, string kind)
    {
        using var form = ImageForm("image/png", Png);
        var response = await client.PostAsync($"/api/me/images/{kind}", form);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await ReadJsonAsync(response)).GetProperty($"{kind}Url").GetString()!;
    }

    private static MultipartFormDataContent ImageForm(string contentType, byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        var image = new ByteArrayContent(bytes);
        image.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(image, "file", "picture");
        return form;
    }

    private static async Task<HttpClient> SignInAsync(
        StellarrWebApplicationFactory factory,
        string username,
        string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password })).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
