using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Domain;
using Stellarr.Api.Embeds;
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

    [Theory]
    [InlineData("en")]
    [InlineData("pl")]
    public void LinkPreviewsAskForPagesTheSameWayInEveryInstanceLanguage(string language)
    {
        using var host = new StellarrWebApplicationFactory(
            loadTestData: false,
            new Dictionary<string, string?> { [LanguageOptions.SettingName] = language });

        using var client = host.Services.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(ILinkUnfurler));

        var asked = client.DefaultRequestHeaders.AcceptLanguage.Select(x => (x.Value, x.Quality)).ToArray();
        Assert.Equal([("pl", (double?)null), ("en", 0.8)], asked);
    }

    [Theory]
    [InlineData("en", "Attachment")]
    [InlineData("pl", "Załącznik")]
    public void AReplyToAnAttachmentAloneIsQuotedInTheLanguageOfTheInstance(string language, string expected)
    {
        var author = new User
        {
            Id = Guid.NewGuid(),
            Username = "jo",
            NormalizedUsername = "JO",
            DisplayName = "Jo",
            PasswordHash = "-",
            AvatarColor = "#777777",
        };
        var message = new Message
        {
            Id = Guid.NewGuid(),
            ChannelId = Guid.NewGuid(),
            AuthorId = author.Id,
            Author = author,
            Content = "",
            Attachments = [new MessageAttachment { AttachmentId = Guid.NewGuid() }],
        };

        Assert.Equal(expected, message.ToReferenceDto(Catalog(language)).Preview);
    }

    [Fact]
    public async Task TheFirstRegistrationFoundsAnInstanceThatSpeaksEnglish()
    {
        using var factory = EnglishHost();
        using var client = SignedInClient(factory);

        await RegisterOwnerAsync(client);

        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(["Owner", "Member"], await db.ServerRoles.OrderBy(x => x.Position).Select(x => x.Name).ToArrayAsync());
        var channels = await db.Channels.OrderBy(x => x.Position).ToArrayAsync();
        Assert.Equal([("general", ChannelKind.Text), ("voice", ChannelKind.Voice)], channels.Select(x => (x.Name, x.Kind)).ToArray());
        Assert.Equal("<b>First Owner</b> has joined the server. Say hello!", (await db.Messages.SingleAsync()).Content);
        Assert.Equal("Unknown device", (await db.UserSessions.SingleAsync()).Device);
    }

    [Fact]
    public async Task AServerCreatedWithoutChannelNamesGetsEnglishOnes()
    {
        using var factory = EnglishHost();
        using var client = SignedInClient(factory);
        await RegisterOwnerAsync(client);

        using var created = await client.PostAsJsonAsync("/api/servers", new { name = "Crew" });

        created.EnsureSuccessStatusCode();
        var serverId = Guid.Parse((await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!);
        await using var scope = factory.OpenScope(out var db);
        Assert.Equal(
            ["general", "voice"],
            await db.Channels.Where(x => x.ServerId == serverId).OrderBy(x => x.Position).Select(x => x.Name).ToArrayAsync());
        Assert.Equal(
            ["Owner", "Member"],
            await db.ServerRoles.Where(x => x.ServerId == serverId).OrderBy(x => x.Position).Select(x => x.Name).ToArrayAsync());
    }

    [Fact]
    public async Task TheAuditTrailIsWrittenInTheLanguageOfTheHostAndNeverRewritten()
    {
        using var factory = EnglishHost();
        using var client = SignedInClient(factory);
        await RegisterOwnerAsync(client);
        await using (var scope = factory.OpenScope(out var db))
        {
            db.ServerAuditEntries.Add(new ServerAuditEntry
            {
                Id = Guid.NewGuid(),
                ServerId = (await db.Servers.SingleAsync()).Id,
                ActorId = (await db.Users.SingleAsync()).Id,
                Summary = "First Owner utworzył(a) zaproszenie",
                CreatedAt = DateTime.UtcNow.AddMinutes(-5),
            });
            await db.SaveChangesAsync();
        }

        (await client.PostAsJsonAsync("/api/admin/invites", new { })).EnsureSuccessStatusCode();

        var entries = await client.GetFromJsonAsync<JsonElement>("/api/admin/audit");
        Assert.Equal(
            ["First Owner created an invite", "First Owner utworzył(a) zaproszenie"],
            entries.EnumerateArray().Select(x => x.GetProperty("summary").GetString()!).Order().ToArray());
    }

    [Fact]
    public async Task ThePasswordResetMailIsWrittenInTheLanguageOfTheHost()
    {
        using var factory = EnglishHost();
        using var client = SignedInClient(factory);
        await RegisterOwnerAsync(client);

        using var response = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email = "owner@example.test" });

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var mail = Assert.Single(factory.EmailDelivery.Messages);
        Assert.Equal("Reset your password on Stellarr", mail.Subject);
        Assert.StartsWith("Hi First Owner,", mail.Text, StringComparison.Ordinal);
        Assert.Contains("<html lang=\"en\">", mail.Html, StringComparison.Ordinal);
        Assert.Contains("Set a new password", mail.Html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheSingleSignOnButtonIsNamedInTheLanguageOfTheHostUnlessTheOperatorNamedIt()
    {
        using var english = EnglishHost();
        using var englishClient = english.CreateClient();
        using var named = new StellarrWebApplicationFactory(
            loadTestData: false,
            new Dictionary<string, string?> { [LanguageOptions.SettingName] = "en" },
            configureServices: services =>
            {
                services.RemoveAll<ExternalOidcOptions>();
                services.AddSingleton(new ExternalOidcOptions { DisplayName = "Company login" });
            });
        using var namedClient = named.CreateClient();

        var byDefault = await englishClient.GetFromJsonAsync<JsonElement>("/api/auth/oidc");
        var byOperator = await namedClient.GetFromJsonAsync<JsonElement>("/api/auth/oidc");

        Assert.Equal("Main account", byDefault.GetProperty("displayName").GetString());
        Assert.Equal("Company login", byOperator.GetProperty("displayName").GetString());
    }

    private static HttpClient SignedInClient(StellarrWebApplicationFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });

    private static async Task RegisterOwnerAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/auth/register",
            new { username = "owner", displayName = "First Owner", email = "owner@example.test", password = "Corona!2026" });
        response.EnsureSuccessStatusCode();
    }
}
