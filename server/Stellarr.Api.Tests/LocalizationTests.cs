using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Tests;

public sealed class LocalizationTests
{
    private static readonly string[] Languages = [LanguageOptions.English, LanguageOptions.Polish];

    private static Messages Catalog(string language) => new(new LanguageOptions { Language = language });

    private static StellarrWebApplicationFactory EnglishHost() =>
        new(loadTestData: false, new Dictionary<string, string?> { [LanguageOptions.SettingName] = "en" });

    private static string[] PlaceholdersOf(string template) =>
        Messages.Placeholder().Matches(template).Select(x => x.Groups[1].Value).Order().ToArray();

    [Fact]
    public void TheInstanceSpeaksEnglishWhenNoLanguageIsSet()
    {
        var configuration = new ConfigurationBuilder().Build();

        var options = configuration.GetSection(LanguageOptions.SectionName).Get<LanguageOptions>() ?? new LanguageOptions();

        Assert.Equal("en", options.Language);
        Assert.Equal("en", Catalog(options.Language).Language);
        Assert.Equal("Invalid username or password.", Catalog(options.Language).Get(MessageKey.SignInFailed));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void ABlankLanguageIsTheSameAsNoneAtAll(string blank)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [LanguageOptions.SettingName] = blank })
            .Build();

        var options = configuration.GetSection(LanguageOptions.SectionName).Get<LanguageOptions>()!;

        Assert.Equal("en", options.Language);
    }

    [Theory]
    [InlineData("pl", "Nieprawidłowy login lub hasło.")]
    [InlineData("en", "Invalid username or password.")]
    public void ALanguageSelectsItsOwnTexts(string language, string expected)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [LanguageOptions.SettingName] = language })
            .Build();
        var options = configuration.GetSection(LanguageOptions.SectionName).Get<LanguageOptions>()!;

        Assert.Equal(expected, Catalog(options.Language).Get(MessageKey.SignInFailed));
    }

    [Fact]
    public void BothLanguagesTellTheSameThing()
    {
        var english = Catalog(LanguageOptions.English);
        var polish = Catalog(LanguageOptions.Polish);

        foreach (var key in Enum.GetValues<MessageKey>())
        {
            Assert.False(string.IsNullOrWhiteSpace(english.Template(key)), $"{key} has no English text");
            Assert.False(string.IsNullOrWhiteSpace(polish.Template(key)), $"{key} has no Polish text");
            Assert.True(
                PlaceholdersOf(english.Template(key)).SequenceEqual(PlaceholdersOf(polish.Template(key))),
                $"{key} has different placeholders in English and in Polish");
        }
    }

    [Fact]
    public void APlaceholderTakesTheValueOfItsName()
    {
        foreach (var language in Languages)
        {
            var text = Catalog(language).Get(MessageKey.ClientOutdated, ("reported", "1.2.3"), ("minimum", new Version(2, 0)));

            Assert.Contains("1.2.3", text, StringComparison.Ordinal);
            Assert.Contains("2.0", text, StringComparison.Ordinal);
            Assert.DoesNotContain('{', text);
        }
    }

    [Fact]
    public void ATextWhosePlaceholderHasNoValueIsRefused()
    {
        Assert.Throws<ArgumentException>(() => Catalog(LanguageOptions.English).Get(MessageKey.ClientOutdated, ("reported", "1.2.3")));
    }

    [Fact]
    public void AnUnknownLanguageStopsTheHostAtStartUp()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: false,
            new Dictionary<string, string?> { [LanguageOptions.SettingName] = "de" });

        var failure = Record.Exception(() => factory.CreateClient());

        Assert.NotNull(failure);
        Assert.Contains("Stellarr:Language", failure.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AHostSetToEnglishAnswersInEnglishWhateverTheEnvironmentSays()
    {
        using var factory = EnglishHost();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Remove(Auth.ClientGate.KindHeader);

        using var response = await client.GetAsync("/api/session");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            "This app is no longer supported. Download the current Stellarr client.",
            problem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task AValidationFailureIsPhrasedInTheLanguageOfTheHost()
    {
        using var factory = EnglishHost();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync(
            "/api/auth/register",
            new { username = "ab", displayName = "Ab", email = "ab@example.test", password = "long enough password" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            "Username must be 3–32 characters: letters, digits, dot, hyphen or underscore.",
            problem.GetProperty("errors").GetProperty("username")[0].GetString());
    }

    [Fact]
    public async Task AFailedSignInIsAnsweredInTheLanguageOfTheHost()
    {
        using var factory = EnglishHost();
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync("/api/auth/login", new { username = "nobody", password = "wrong password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Invalid username or password.", problem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task HostsOfDifferentLanguagesDoNotInfluenceEachOther()
    {
        using var english = EnglishHost();
        using var polish = new StellarrWebApplicationFactory(
            loadTestData: false,
            new Dictionary<string, string?> { [LanguageOptions.SettingName] = "pl" });
        using var englishClient = english.CreateClient();
        using var polishClient = polish.CreateClient();

        var login = new { username = "nobody", password = "wrong password" };
        using var inEnglish = await englishClient.PostAsJsonAsync("/api/auth/login", login);
        using var inPolish = await polishClient.PostAsJsonAsync("/api/auth/login", login);

        Assert.Equal("Invalid username or password.", (await inEnglish.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());
        Assert.Equal("Nieprawidłowy login lub hasło.", (await inPolish.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());
    }
}
