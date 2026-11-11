using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Stellarr.Api.Tests;

public sealed class CockpitSettingsTests
{
    [Theory]
    [InlineData("GET", "/api/cockpit/settings")]
    [InlineData("PUT", "/api/cockpit/settings")]
    [InlineData("GET", "/api/cockpit/desktop-release")]
    [InlineData("PUT", "/api/cockpit/desktop-release")]
    [InlineData("POST", "/api/cockpit/mail/test")]
    public async Task OnlyTheInstanceOwnerChangesTheConfiguration(string method, string path)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var anonymous = Client(factory);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(anonymous, method, path)).StatusCode);

        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(member, method, path)).StatusCode);
    }

    [Fact]
    public async Task SettingsStartFromTheConfigurationAndNeverRevealTheMailKey()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        var response = await owner.GetAsync("/api/cockpit/settings");

        var settings = await JsonAsync(response);
        Assert.Equal("Orbit", settings.GetProperty("instanceName").GetString());
        Assert.Equal("https://chat.test", settings.GetProperty("publicUrl").GetString());
        Assert.True(settings.GetProperty("mailingEnabled").GetBoolean());
        Assert.Equal("onboarding@resend.dev", settings.GetProperty("mailFromAddress").GetString());
        Assert.Equal(14, settings.GetProperty("backupRetentionDays").GetInt32());
        Assert.Equal(30, settings.GetProperty("logRetentionDays").GetInt32());
        Assert.Equal(1, settings.GetProperty("orphanObjectRetentionDays").GetInt32());
        Assert.True(settings.GetProperty("resendApiKeyConfigured").GetBoolean());
        Assert.DoesNotContain("re_test", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task SettingsSayWhenNoMailKeyIsConfigured()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["Mail:ResendApiKey"] = "" });
        using var owner = await OwnerAsync(factory);

        var settings = await JsonAsync(await owner.GetAsync("/api/cockpit/settings"));

        Assert.False(settings.GetProperty("resendApiKeyConfigured").GetBoolean());
    }

    [Theory]
    [InlineData("instanceName", "", "instanceName")]
    [InlineData("publicUrl", "ftp://chat.test", "publicUrl")]
    [InlineData("publicUrl", "https://name:secret@chat.test", "publicUrl")]
    [InlineData("timeZone", "Mars/Olympus", "timeZone")]
    [InlineData("mailFromAddress", "", "mailFromAddress")]
    [InlineData("backupRetentionDays", 0, "backupRetentionDays")]
    [InlineData("logRetentionDays", 3651, "logRetentionDays")]
    [InlineData("orphanObjectRetentionDays", -1, "orphanObjectRetentionDays")]
    public async Task SettingsRefuseAnInvalidField(string field, object value, string reportedField)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["mailingEnabled"] = true;
        settings[field] = value;

        var response = await owner.PutAsJsonAsync("/api/cockpit/settings", settings);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty(reportedField, out _));
    }

    [Fact]
    public async Task SavedSettingsRenameTheInstanceAndAreAudited()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["instanceName"] = "Orbit Ops";
        (await owner.PutAsJsonAsync("/api/cockpit/settings", settings)).EnsureSuccessStatusCode();
        settings["logRetentionDays"] = 90;

        var second = await owner.PutAsJsonAsync("/api/cockpit/settings", settings);

        second.EnsureSuccessStatusCode();
        Assert.Equal(90, (await JsonAsync(second)).GetProperty("logRetentionDays").GetInt32());
        var bootstrap = await JsonAsync(await owner.GetAsync("/api/cockpit/bootstrap"));
        Assert.Equal("Orbit Ops", bootstrap.GetProperty("instance").GetProperty("name").GetString());
        var logs = await JsonAsync(await owner.GetAsync("/api/cockpit/logs"));
        Assert.Contains(
            logs.GetProperty("audit").EnumerateArray(),
            entry => entry.GetProperty("summary").GetString() == "Maja zaktualizował(a) ustawienia Cockpitu");
    }

    [Fact]
    public async Task TestMailIsSentFromTheConfiguredSender()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["mailingEnabled"] = true;
        settings["mailFromAddress"] = "sender@example.net";
        (await owner.PutAsJsonAsync("/api/cockpit/settings", settings)).EnsureSuccessStatusCode();

        (await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = " person@example.net " }))
            .EnsureSuccessStatusCode();

        var message = Assert.Single(factory.EmailDelivery.Messages);
        Assert.Equal("Stellarr <sender@example.net>", message.From);
        Assert.Equal("person@example.net", message.To);
        Assert.Contains("Orbit", message.Subject);
    }

    [Theory]
    [InlineData("not-an-address")]
    [InlineData("Person <person@example.net>")]
    [InlineData("")]
    public async Task TestMailRefusesAnInvalidRecipient(string recipient)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        var response = await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = recipient });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.EmailDelivery.Messages);
    }

    [Fact]
    public async Task TestMailWaitsUntilMailingIsEnabled()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        (await owner.PutAsJsonAsync("/api/cockpit/settings", ValidSettings())).EnsureSuccessStatusCode();

        var response = await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(factory.EmailDelivery.Messages);
    }

    [Fact]
    public async Task TestMailWaitsUntilTheProviderKeyIsConfigured()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["Mail:ResendApiKey"] = "" });
        using var owner = await OwnerAsync(factory);

        var response = await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(factory.EmailDelivery.Messages);
    }

    [Fact]
    public async Task DesktopReleaseShowsTheConfiguredVersionsAndWhatIsPublished()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        var before = await JsonAsync(await owner.GetAsync("/api/cockpit/desktop-release"));
        Assert.Equal("0.1.0", before.GetProperty("minimumVersion").GetString());
        Assert.Equal("0.1.0", before.GetProperty("recommendedVersion").GetString());
        Assert.Equal(JsonValueKind.Null, before.GetProperty("published").ValueKind);
        Assert.Equal(JsonValueKind.Null, before.GetProperty("androidPublished").ValueKind);

        PublishDesktop(factory.DataRoot, "0.3.0");
        var after = await JsonAsync(await owner.GetAsync("/api/cockpit/desktop-release"));
        Assert.Equal("0.3.0", after.GetProperty("published").GetProperty("version").GetString());
    }

    [Fact]
    public async Task DesktopReleaseRefusesAMinimumAboveTheRecommendedVersion()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        var response = await owner.PutAsJsonAsync("/api/cockpit/desktop-release", new
        {
            minimumVersion = "0.2.0",
            recommendedVersion = "0.1.0",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("recommendedVersion", out _));
        var current = await JsonAsync(await owner.GetAsync("/api/cockpit/desktop-release"));
        Assert.Equal("0.1.0", current.GetProperty("minimumVersion").GetString());
    }

    [Fact]
    public async Task DesktopReleaseKeepsTheVersionsWhenAManifestIsBroken()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var directory = Directory.CreateDirectory(Path.Combine(factory.DataRoot, "releases", "desktop"));
        await File.WriteAllTextAsync(Path.Combine(directory.FullName, "desktop-release.json"), "{}");

        Assert.Equal(
            HttpStatusCode.ServiceUnavailable,
            (await owner.GetAsync("/api/cockpit/desktop-release")).StatusCode);
        var saved = await owner.PutAsJsonAsync("/api/cockpit/desktop-release", new
        {
            minimumVersion = "0.2.0",
            recommendedVersion = "0.2.1",
        });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, saved.StatusCode);
        File.Delete(Path.Combine(directory.FullName, "desktop-release.json"));
        var current = await JsonAsync(await owner.GetAsync("/api/cockpit/desktop-release"));
        Assert.Equal("0.2.0", current.GetProperty("minimumVersion").GetString());
        Assert.Equal("0.2.1", current.GetProperty("recommendedVersion").GetString());
    }

    private static Dictionary<string, object?> ValidSettings() => new()
    {
        ["instanceName"] = "Orbit",
        ["publicUrl"] = "https://chat.test",
        ["timeZone"] = "UTC",
        ["mailingEnabled"] = false,
        ["mailFromAddress"] = "stellarr@example.net",
        ["inviteMailEnabled"] = true,
        ["recoveryMailEnabled"] = true,
        ["alertMailEnabled"] = false,
        ["backupRetentionDays"] = 14,
        ["logRetentionDays"] = 30,
        ["orphanObjectRetentionDays"] = 1,
        ["automaticCleanupEnabled"] = true,
    };

    private static void PublishDesktop(string dataRoot, string version)
    {
        var directory = Directory.CreateDirectory(Path.Combine(dataRoot, "releases", "desktop"));
        var package = "desktop package"u8.ToArray();
        var fileName = $"stellarr-desktop-{version}-1-x86_64.pkg.tar.zst";
        File.WriteAllBytes(Path.Combine(directory.FullName, fileName), package);
        File.WriteAllText(
            Path.Combine(directory.FullName, "desktop-release.json"),
            JsonSerializer.Serialize(new
            {
                schemaVersion = 1,
                version,
                publishedAt = DateTime.UtcNow,
                notes = $"Stellarr Desktop {version}",
                artifact = new
                {
                    platform = "arch",
                    architecture = "x86_64",
                    fileName,
                    sizeBytes = package.LongLength,
                    sha256 = Convert.ToHexStringLower(SHA256.HashData(package)),
                },
            }));
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, string method, string path) =>
        client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

    private static async Task<HttpClient> OwnerAsync(StellarrWebApplicationFactory factory)
    {
        var client = Client(factory);
        await LoginAsync(client, "maja", "Aurora!2026");
        return client;
    }

    private static HttpClient Client(StellarrWebApplicationFactory factory) => factory.CreateClient(
        new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
        });

    private static async Task LoginAsync(HttpClient client, string username, string password) =>
        (await client.PostAsJsonAsync("/api/auth/login", new { username, password }))
            .EnsureSuccessStatusCode();

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }
}
