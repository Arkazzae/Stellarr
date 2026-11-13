using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Stellarr.Api.Tests;

/// <summary>
/// The client's own settings, kept on the account so the theme, language,
/// shortcuts and voice processing follow a person to every device.
/// </summary>
public sealed class ClientSettingsTests
{
    [Fact]
    public async Task AnAccountThatNeverSavedAnySectionReadsEveryOneAsNull()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");

        var settings = await ReadJsonAsync(await client.GetAsync("/api/me/settings"));

        foreach (var section in new[] { "appearance", "language", "keybinds", "voice" })
        {
            Assert.Equal(JsonValueKind.Null, settings.GetProperty(section).ValueKind);
        }
    }

    [Fact]
    public async Task ASectionIsReplacedWholeAndTheOthersAreLeftAlone()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "nils", "Zenith!2026");

        (await PutAsync(client, "appearance", """{ "palette": "ember", "size": "lg" }""")).EnsureSuccessStatusCode();
        (await PutAsync(client, "keybinds", """{ "toggleMute": null }""")).EnsureSuccessStatusCode();
        var response = await PutAsync(client, "appearance", """{ "palette": "tide" }""");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var settings = await ReadJsonAsync(await client.GetAsync("/api/me/settings"));
        var appearance = settings.GetProperty("appearance");
        Assert.Equal("tide", appearance.GetProperty("palette").GetString());
        Assert.False(appearance.TryGetProperty("size", out _));
        Assert.Equal(JsonValueKind.Null, settings.GetProperty("keybinds").GetProperty("toggleMute").ValueKind);
        Assert.Equal(JsonValueKind.Null, settings.GetProperty("voice").ValueKind);
    }

    [Fact]
    public async Task EverySectionSavedAtOnceByAFreshAccountIsKept()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ilya", "Meteor!2026");
        await using (var scope = factory.OpenScope(out var db))
        {
            // The first sign-in after the upgrade: no preference row yet.
            await db.UserPreferences.Where(x => x.User.Username == "ilya").ExecuteDeleteAsync();
        }

        var responses = await Task.WhenAll(
            PutAsync(client, "appearance", """{ "size": "lg" }"""),
            PutAsync(client, "language", """{ "locale": "en" }"""),
            PutAsync(client, "keybinds", """{ "version": 1 }"""),
            PutAsync(client, "voice", """{ "version": 1 }"""));

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.NoContent, response.StatusCode));
        var settings = await ReadJsonAsync(await client.GetAsync("/api/me/settings"));
        foreach (var section in new[] { "appearance", "language", "keybinds", "voice" })
        {
            Assert.Equal(JsonValueKind.Object, settings.GetProperty(section).ValueKind);
        }
    }

    [Fact]
    public async Task SettingsBelongToTheAccountThatSavedThem()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var ada = await SignInAsync(factory, "ada", "Quasar!2026");
        using var nils = await SignInAsync(factory, "nils", "Zenith!2026");

        (await PutAsync(ada, "language", """{ "locale": "en" }""")).EnsureSuccessStatusCode();

        var theirs = await ReadJsonAsync(await nils.GetAsync("/api/me/settings"));
        Assert.Equal(JsonValueKind.Null, theirs.GetProperty("language").ValueKind);
        var again = await ReadJsonAsync(await (await SignInAsync(factory, "ada", "Quasar!2026")).GetAsync("/api/me/settings"));
        Assert.Equal("en", again.GetProperty("language").GetProperty("locale").GetString());
    }

    [Theory]
    [InlineData("[1, 2]")]
    [InlineData("\"dark\"")]
    [InlineData("{ not json")]
    public async Task OnlyAJsonObjectIsStored(string body)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ilya", "Meteor!2026");

        var response = await PutAsync(client, "voice", body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await ReadJsonAsync(response)).GetProperty("errors");
        Assert.Contains("8192", Assert.Single(errors.GetProperty("voice").EnumerateArray()).GetString());
        await using var scope = factory.OpenScope(out var db);
        var preferences = await db.UserPreferences.AsNoTracking()
            .SingleOrDefaultAsync(x => x.User.Username == "ilya");
        Assert.Null(preferences?.VoiceSettingsJson);
    }

    [Fact]
    public async Task ASectionLargerThanTheLimitIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");

        var response = await PutAsync(client, "appearance", $$"""{ "padding": "{{new string('x', 8200)}}" }""");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task WhitespaceDoesNotCountAgainstTheLimit()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");
        var padded = "{" + new string(' ', 9000) + "\"palette\": \"ember\"}";

        var response = await PutAsync(client, "appearance", padded);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await using var scope = factory.OpenScope(out var db);
        var stored = await db.UserPreferences.AsNoTracking()
            .Where(x => x.User.Username == "ada")
            .Select(x => x.AppearanceSettingsJson)
            .SingleAsync();
        Assert.Equal("""{"palette":"ember"}""", stored);
    }

    [Fact]
    public async Task AnUnknownSectionIsNotFound()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = await SignInAsync(factory, "ada", "Quasar!2026");

        var response = await PutAsync(client, "passwords", "{}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task NobodyReadsOrWritesSettingsWithoutSigningIn()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me/settings")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await PutAsync(client, "voice", "{}")).StatusCode);
    }

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, string section, string json) =>
        client.PutAsync($"/api/me/settings/{section}", new StringContent(json, Encoding.UTF8, "application/json"));

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
