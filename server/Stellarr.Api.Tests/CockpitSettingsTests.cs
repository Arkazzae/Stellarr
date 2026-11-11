using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Mail;

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

    [Fact]
    public async Task SmtpSettingsAreStoredAndSendTheTestMail()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["Mail:SmtpPassword"] = "smtp-secret" });
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["mailingEnabled"] = true;
        settings["mailFromAddress"] = "sender@example.net";
        settings["smtpHost"] = " smtp.example.net ";
        settings["smtpPort"] = 465;
        settings["smtpSecurity"] = "TLS";
        settings["smtpUsername"] = "mailer";
        settings["resendEnabled"] = false;

        var response = await owner.PutAsJsonAsync("/api/cockpit/settings", settings);

        var text = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        Assert.DoesNotContain("smtp-secret", text, StringComparison.Ordinal);
        var saved = await JsonAsync(response);
        Assert.Equal("smtp", saved.GetProperty("mailProvider").GetString());
        Assert.Equal("smtp.example.net", saved.GetProperty("smtpHost").GetString());
        Assert.Equal(465, saved.GetProperty("smtpPort").GetInt32());
        Assert.Equal("tls", saved.GetProperty("smtpSecurity").GetString());
        Assert.Equal("mailer", saved.GetProperty("smtpUsername").GetString());
        Assert.True(saved.GetProperty("smtpPasswordConfigured").GetBoolean());
        Assert.False(saved.GetProperty("resendEnabled").GetBoolean());
        Assert.True(saved.GetProperty("mailReady").GetBoolean());

        var test = await JsonAsync(await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" }));

        Assert.Equal("smtp", test.GetProperty("provider").GetString());
        var transport = Assert.Single(factory.EmailDelivery.Transports);
        Assert.Equal(MailProvider.Smtp, transport.Provider);
        Assert.Equal(new SmtpConnection("smtp.example.net", 465, SmtpSecurity.Tls, "mailer", "smtp-secret"), transport.Smtp);
    }

    [Fact]
    public async Task ChoosingResendSendsThroughItAndLeavingFieldsOutKeepsThem()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["mailingEnabled"] = true;
        settings["smtpHost"] = "smtp.example.net";
        settings["resendEnabled"] = true;
        (await owner.PutAsJsonAsync("/api/cockpit/settings", settings)).EnsureSuccessStatusCode();
        var withoutMailFields = ValidSettings();
        withoutMailFields["mailingEnabled"] = true;

        var saved = await JsonAsync(await owner.PutAsJsonAsync("/api/cockpit/settings", withoutMailFields));
        (await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" })).EnsureSuccessStatusCode();

        Assert.Equal("resend", saved.GetProperty("mailProvider").GetString());
        Assert.Equal("smtp.example.net", saved.GetProperty("smtpHost").GetString());
        Assert.Equal(MailProvider.Resend, Assert.Single(factory.EmailDelivery.Transports).Provider);
    }

    [Fact]
    public async Task TestMailWaitsForAnSmtpServerOnceSmtpIsChosen()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["mailingEnabled"] = true;
        settings["resendEnabled"] = false;
        (await owner.PutAsJsonAsync("/api/cockpit/settings", settings)).EnsureSuccessStatusCode();

        var response = await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("SMTP", (await ProblemAsync(response)).GetProperty("detail").GetString(), StringComparison.Ordinal);
        Assert.Empty(factory.EmailDelivery.Messages);
    }

    [Fact]
    public async Task ARefusedTestMailSaysWhatTheProviderAnswered()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);
        var settings = ValidSettings();
        settings["mailingEnabled"] = true;
        (await owner.PutAsJsonAsync("/api/cockpit/settings", settings)).EnsureSuccessStatusCode();
        factory.EmailDelivery.Failure = new MailDeliveryException("SMTP smtp.example.net:587: 535 Authentication failed");

        var response = await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" });

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var problem = await ProblemAsync(response);
        Assert.Equal("SMTP smtp.example.net:587: 535 Authentication failed", problem.GetProperty("detail").GetString());
    }

    [Theory]
    [InlineData("instanceName", "", "instanceName")]
    [InlineData("timeZone", "Mars/Olympus", "timeZone")]
    [InlineData("mailFromAddress", "", "mailFromAddress")]
    [InlineData("backupRetentionDays", 0, "backupRetentionDays")]
    [InlineData("logRetentionDays", 3651, "logRetentionDays")]
    [InlineData("orphanObjectRetentionDays", -1, "orphanObjectRetentionDays")]
    [InlineData("smtpPort", 0, "smtpPort")]
    [InlineData("smtpPort", 65536, "smtpPort")]
    [InlineData("smtpSecurity", "ssl3", "smtpSecurity")]
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
        await using (var scope = factory.OpenScope(out var db))
        {
            Assert.Contains(
                await db.ServerAuditEntries.AsNoTracking().Select(entry => entry.Summary).ToListAsync(),
                summary => summary == "Maja zaktualizował(a) ustawienia Cockpitu");
        }
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

    /// <summary>The body of a response that is not a success, read as JSON.</summary>
    private static async Task<JsonElement> ProblemAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static Dictionary<string, object?> ValidSettings() => new()
    {
        ["instanceName"] = "Orbit",
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
