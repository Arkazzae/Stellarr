using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Tests;

public sealed class CockpitSecretsTests
{
    private static readonly Dictionary<string, string?> NoEnvironmentSecrets = new()
    {
        ["Mail:ResendApiKey"] = "",
        ["Mail:SmtpPassword"] = "",
        ["GIPHY_API_KEY"] = "",
    };

    [Fact]
    public async Task ASecretSetInThePanelIsStoredEncryptedAndNeverReadBack()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: true, NoEnvironmentSecrets);
        using var owner = await OwnerAsync(factory);

        var response = await owner.PutAsJsonAsync("/api/cockpit/secrets/mail.smtp-password", new { value = " pass with spaces " });

        var text = await response.Content.ReadAsStringAsync();
        response.EnsureSuccessStatusCode();
        Assert.DoesNotContain("pass with spaces", text, StringComparison.Ordinal);
        var secret = await JsonAsync(response);
        Assert.True(secret.GetProperty("configured").GetBoolean());
        Assert.Equal("panel", secret.GetProperty("source").GetString());
        Assert.Equal("STELLARR_SMTP_PASSWORD", secret.GetProperty("variable").GetString());

        var listed = await owner.GetStringAsync("/api/cockpit/secrets");
        Assert.DoesNotContain("pass with spaces", listed, StringComparison.Ordinal);
        await using (factory.OpenScope(out var db))
        {
            var row = await db.InstanceSecrets.AsNoTracking().SingleAsync();
            Assert.Equal(SecretNames.SmtpPassword, row.Name);
            Assert.DoesNotContain("pass", row.ProtectedValue, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ThePanelsValueWinsAndRemovingItFallsBackToTheEnvironment()
    {
        using var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            new Dictionary<string, string?> { ["GIPHY_API_KEY"] = " env-giphy " });
        using var owner = await OwnerAsync(factory);
        Assert.Equal("environment", (await SecretAsync(owner, SecretNames.GiphyApiKey)).GetProperty("source").GetString());
        Assert.Equal("env-giphy", await GiphyKeyAsync(owner));

        (await owner.PutAsJsonAsync("/api/cockpit/secrets/giphy.api-key", new { value = "panel-giphy" })).EnsureSuccessStatusCode();
        Assert.Equal("panel", (await SecretAsync(owner, SecretNames.GiphyApiKey)).GetProperty("source").GetString());
        Assert.Equal("panel-giphy", await GiphyKeyAsync(owner));

        var cleared = await JsonAsync(await owner.DeleteAsync("/api/cockpit/secrets/giphy.api-key"));
        Assert.Equal("environment", cleared.GetProperty("source").GetString());
        Assert.True(cleared.GetProperty("configured").GetBoolean());
        Assert.Equal("env-giphy", await GiphyKeyAsync(owner));
    }

    [Fact]
    public async Task TheTestMailSendsWithThePasswordSetInThePanel()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: true, NoEnvironmentSecrets);
        using var owner = await OwnerAsync(factory);
        var settings = new Dictionary<string, object?>
        {
            ["instanceName"] = "Orbit",
            ["timeZone"] = "UTC",
            ["mailingEnabled"] = true,
            ["mailFromAddress"] = "sender@example.net",
            ["inviteMailEnabled"] = true,
            ["recoveryMailEnabled"] = true,
            ["alertMailEnabled"] = false,
            ["backupRetentionDays"] = 14,
            ["logRetentionDays"] = 30,
            ["orphanObjectRetentionDays"] = 1,
            ["automaticCleanupEnabled"] = true,
            ["smtpHost"] = "smtp.example.net",
            ["smtpUsername"] = "mailer",
            ["resendEnabled"] = false,
        };
        var before = await JsonAsync(await owner.PutAsJsonAsync("/api/cockpit/settings", settings));
        Assert.False(before.GetProperty("smtpPasswordConfigured").GetBoolean());

        (await owner.PutAsJsonAsync("/api/cockpit/secrets/mail.smtp-password", new { value = "from-the-panel" })).EnsureSuccessStatusCode();
        var after = await JsonAsync(await owner.GetAsync("/api/cockpit/settings"));
        (await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" })).EnsureSuccessStatusCode();

        Assert.True(after.GetProperty("smtpPasswordConfigured").GetBoolean());
        Assert.Equal("from-the-panel", Assert.Single(factory.EmailDelivery.Transports).Smtp!.Password);
    }

    [Fact]
    public async Task AResendKeySetInThePanelMakesResendReadyAndGoesWithTheMail()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: true, NoEnvironmentSecrets);
        using var owner = await OwnerAsync(factory);
        var settings = await JsonAsync(await owner.GetAsync("/api/cockpit/settings"));
        Assert.False(settings.GetProperty("resendApiKeyConfigured").GetBoolean());

        (await owner.PutAsJsonAsync("/api/cockpit/secrets/mail.resend-api-key", new { value = " re_panel " })).EnsureSuccessStatusCode();
        var updated = await JsonAsync(await owner.GetAsync("/api/cockpit/settings"));
        (await owner.PostAsJsonAsync("/api/cockpit/mail/test", new { to = "person@example.net" })).EnsureSuccessStatusCode();

        Assert.True(updated.GetProperty("resendApiKeyConfigured").GetBoolean());
        Assert.Equal("resend", updated.GetProperty("mailProvider").GetString());
        Assert.True(updated.GetProperty("mailReady").GetBoolean());
        Assert.Equal("re_panel", Assert.Single(factory.EmailDelivery.Transports).ResendApiKey);
    }

    [Fact]
    public async Task ASecretTheKeysCannotDecryptCountsAsUnset()
    {
        using var factory = new StellarrWebApplicationFactory(loadTestData: true, NoEnvironmentSecrets);
        using var owner = await OwnerAsync(factory);
        await using (factory.OpenScope(out var db))
        {
            db.InstanceSecrets.Add(new InstanceSecret
            {
                Name = SecretNames.ResendApiKey,
                ProtectedValue = "CfDJ8-written-under-keys-that-are-gone",
                UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var secret = await SecretAsync(owner, SecretNames.ResendApiKey);

        Assert.False(secret.GetProperty("configured").GetBoolean());
        Assert.Equal("none", secret.GetProperty("source").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task AnEmptyValueIsRefused(string value)
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        var response = await owner.PutAsJsonAsync("/api/cockpit/secrets/giphy.api-key", new { value });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AValueLongerThanTheLimitIsRefused()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        var response = await owner.PutAsJsonAsync(
            "/api/cockpit/secrets/giphy.api-key",
            new { value = new string('k', SecretNames.MaxLength + 1) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnUnknownSecretIsNotFound()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var owner = await OwnerAsync(factory);

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await owner.PutAsJsonAsync("/api/cockpit/secrets/storage.secret-key", new { value = "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.DeleteAsync("/api/cockpit/secrets/storage.secret-key")).StatusCode);
    }

    [Fact]
    public async Task OnlyTheOwnerSetsSecrets()
    {
        using var factory = new StellarrWebApplicationFactory();
        using var member = Client(factory);
        await LoginAsync(member, "jo", "Corona!2026");

        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync("/api/cockpit/secrets")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await member.PutAsJsonAsync("/api/cockpit/secrets/giphy.api-key", new { value = "x" })).StatusCode);
    }

    [Fact]
    public void ATransportNeverPrintsItsSecrets()
    {
        var transport = new MailTransport(
            MailProvider.Smtp,
            new SmtpConnection("smtp.example.net", 587, SmtpSecurity.StartTls, "mailer", "hunter2"),
            Ready: true,
            ResendApiKey: "re_secret");

        Assert.DoesNotContain("hunter2", transport.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("re_secret", transport.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain("hunter2", new SecretValue("hunter2", SecretSource.Panel).ToString(), StringComparison.Ordinal);
    }

    private static async Task<JsonElement> SecretAsync(HttpClient owner, string name)
    {
        var all = await JsonAsync(await owner.GetAsync("/api/cockpit/secrets"));
        return all.EnumerateArray().Single(x => x.GetProperty("name").GetString() == name);
    }

    private static async Task<string?> GiphyKeyAsync(HttpClient client) =>
        (await JsonAsync(await client.GetAsync("/api/config/giphy"))).GetProperty("apiKey").GetString();

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
