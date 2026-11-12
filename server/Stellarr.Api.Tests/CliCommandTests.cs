using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Tests;

public sealed class CliCommandTests
{
    [Fact]
    public async Task HelpVersionAndUsageErrorsDoNotTouchTheDataVolume()
    {
        using var fixture = CliFixture.CreateUnstarted();

        var version = await fixture.RunAsync("--json", "version");
        Assert.Equal(0, version.ExitCode);
        using (var json = JsonDocument.Parse(version.Output))
        {
            Assert.True(json.RootElement.GetProperty("ok").GetBoolean());
            Assert.False(string.IsNullOrWhiteSpace(json.RootElement.GetProperty("data").GetProperty("version").GetString()));
        }

        var status = await fixture.RunAsync("--json", "status");
        Assert.Equal(3, status.ExitCode);
        using (var json = JsonDocument.Parse(status.Output))
        {
            Assert.Equal("database_not_found", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        var unknown = await fixture.RunAsync("--json", "not-a-command");
        Assert.Equal(2, unknown.ExitCode);
        using var error = JsonDocument.Parse(unknown.Output);
        Assert.Equal("unknown_command", error.RootElement.GetProperty("error").GetProperty("code").GetString());
        var missingValue = await fixture.RunAsync("--json", "--data-root", "--json", "version");
        Assert.Equal(2, missingValue.ExitCode);
        using (var json = JsonDocument.Parse(missingValue.Output))
        {
            Assert.Equal("usage", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        foreach (var emptyRoot in new[] { "", "   " })
        {
            var empty = await fixture.RunAsync("--json", "--data-root", emptyRoot, "version");
            Assert.Equal(2, empty.ExitCode);
            using var emptyJson = JsonDocument.Parse(empty.Output);
            Assert.Equal("usage", emptyJson.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        var emptyInline = await fixture.RunAsync(
            "--json", "config", "set", "time-zone", "Europe/Warsaw", "--yes", "--data-root=");
        Assert.Equal(2, emptyInline.ExitCode);
        using (var json = JsonDocument.Parse(emptyInline.Output))
        {
            Assert.Equal("usage", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        // A deliberately dash-prefixed value still has the explicit = form.
        var dashValue = await fixture.RunAsync("--data-root=--virtual", "--json", "version");
        Assert.Equal(0, dashValue.ExitCode);

        Assert.False(Directory.Exists(Path.Combine(fixture.Root, "db")));
        Assert.False(Directory.Exists(Path.Combine(fixture.Root, "keys")));
    }

    [Fact]
    public async Task VersionAndHelpNeverLetAWriteCommandRun()
    {
        using var fixture = CliFixture.CreateUnstarted();

        var version = await fixture.RunAsync(
            "config", "set", "time-zone", "Europe/Warsaw", "--yes", "--version");
        Assert.Equal(0, version.ExitCode);
        Assert.DoesNotContain("Set time-zone", version.Output, StringComparison.Ordinal);

        var help = await fixture.RunAsync(
            "config", "set", "time-zone", "Europe/Warsaw", "--yes", "--help");
        Assert.Equal(0, help.ExitCode);
        Assert.DoesNotContain("Set time-zone", help.Output, StringComparison.Ordinal);
        Assert.False(Directory.Exists(Path.Combine(fixture.Root, "db")));
        Assert.False(Directory.Exists(Path.Combine(fixture.Root, "keys")));
    }

    [Fact]
    public async Task ReadCommandsWorkOnAReadOnlyDatabaseWithoutWriting()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();
        var databasePath = Path.Combine(fixture.Root, "db", "stellarr.db");
        await using (var connection = new SqliteConnection($"Data Source={databasePath};Pooling=False"))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;";
            await command.ExecuteNonQueryAsync();
        }

        var originalMode = File.GetUnixFileMode(databasePath);
        try
        {
            File.SetUnixFileMode(databasePath, UnixFileMode.UserRead | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
            var before = Directory.GetFiles(Path.GetDirectoryName(databasePath)!).Order().ToArray();

            Assert.Equal(0, (await fixture.RunAsync("--json", "config", "list")).ExitCode);
            Assert.Equal(0, (await fixture.RunAsync("--json", "users", "list")).ExitCode);
            Assert.Equal(0, (await fixture.RunAsync("--json", "sessions", "list")).ExitCode);
            Assert.Equal(0, (await fixture.RunAsync("--json", "secrets", "list")).ExitCode);

            Assert.Equal(before, Directory.GetFiles(Path.GetDirectoryName(databasePath)!).Order().ToArray());
        }
        finally
        {
            File.SetUnixFileMode(databasePath, originalMode);
        }
    }

    [Fact]
    public async Task ReadCommandsNeverCreateTheKeysDirectory()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();
        Directory.Delete(Path.Combine(fixture.Root, "keys"), recursive: true);

        Assert.Equal(0, (await fixture.RunAsync("--json", "config", "list")).ExitCode);
        Assert.Equal(0, (await fixture.RunAsync("--json", "users", "list")).ExitCode);
        var secrets = await fixture.RunAsync("--json", "secrets", "list");
        Assert.Equal(0, secrets.ExitCode);

        Assert.False(Directory.Exists(Path.Combine(fixture.Root, "keys")));
        Assert.True(File.Exists(Path.Combine(fixture.Root, "db", "stellarr.db")));
    }

    [Fact]
    public async Task ConfigSetUsesSharedValidationAndAuditsInTheSameTransaction()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        var set = await fixture.RunAsync("--json", "config", "set", "time-zone", "Europe/Warsaw", "--yes");
        Assert.Equal(0, set.ExitCode);
        using (var json = JsonDocument.Parse(set.Output))
        {
            Assert.Equal("Europe/Warsaw", json.RootElement.GetProperty("data").GetProperty("value").GetString());
            Assert.Equal("local-cli", json.RootElement.GetProperty("data").GetProperty("auditActor").GetString());
        }

        await using (var db = fixture.OpenDb())
        {
            var settings = await db.OperationsSettings.SingleAsync();
            Assert.Equal("Europe/Warsaw", settings.TimeZone);
            var audit = await db.OperatorAuditEntries.SingleAsync();
            Assert.Equal("local-cli", audit.Actor);
            Assert.Equal("config.set", audit.Operation);
            Assert.Equal("time-zone", audit.Target);
        }

        var invalid = await fixture.RunAsync("--json", "config", "set", "mail.smtp.port", "99999", "--yes");
        Assert.Equal(2, invalid.ExitCode);
        using (var json = JsonDocument.Parse(invalid.Output))
        {
            Assert.Equal("invalid_value", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        var readOnly = await fixture.RunAsync("--json", "config", "set", "public-url", "https://chat.example", "--yes");
        Assert.Equal(4, readOnly.ExitCode);
        using (var json = JsonDocument.Parse(readOnly.Output))
        {
            Assert.Equal("read_only_setting", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        await using (var db = fixture.OpenDb())
        {
            Assert.Equal("Europe/Warsaw", (await db.OperationsSettings.SingleAsync()).TimeZone);
            Assert.Equal(1, await db.OperatorAuditEntries.CountAsync());
        }
    }

    [Fact]
    public async Task ConfigSetInstanceNamePersistsAndCockpitSeesIt()
    {
        using var fixture = await CliFixture.StartAsync();
        using var owner = fixture.Factory.CreateClient();
        var login = await owner.PostAsJsonAsync(
            "/api/auth/login", new { username = "maja", password = "Aurora!2026" });
        Assert.True(login.IsSuccessStatusCode, await login.Content.ReadAsStringAsync());

        var set = await fixture.RunAsync(
            "--json", "config", "set", "instance.name", "Orbit CLI", "--yes");
        Assert.Equal(0, set.ExitCode);

        await using (var db = fixture.OpenDb())
        {
            Assert.Equal("Orbit CLI", (await db.Servers.SingleAsync()).Name);
        }

        var settings = await owner.GetFromJsonAsync<JsonElement>("/api/cockpit/settings");
        Assert.Equal("Orbit CLI", settings.GetProperty("instanceName").GetString());
    }

    [Fact]
    public async Task EmptyTextSettingsAreAllowedWhenTheSharedRulesAllowThem()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        Assert.Equal(0, (await fixture.RunAsync(
            "--json", "config", "set", "mail.smtp.host", "", "--yes")).ExitCode);
        Assert.Equal(0, (await fixture.RunAsync(
            "--json", "config", "set", "mail.smtp.username", "", "--yes")).ExitCode);
        Assert.Equal(0, (await fixture.RunAsync(
            "--json", "config", "set", "mail.from-address", "", "--yes")).ExitCode);

        await using (var db = fixture.OpenDb())
        {
            var settings = await db.OperationsSettings.SingleAsync();
            Assert.Equal("", settings.MailSmtpHost);
            Assert.Equal("", settings.MailSmtpUsername);
            Assert.Equal("", settings.MailFromAddress);
            Assert.Equal(3, await db.OperatorAuditEntries.CountAsync());
        }

        var auditsBefore = 3;
        var invalid = await fixture.RunAsync(
            "--json", "config", "set", "instance.name", "", "--yes");
        Assert.Equal(2, invalid.ExitCode);
        using (var json = JsonDocument.Parse(invalid.Output))
        {
            Assert.Equal("invalid_value", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        await using (var db = fixture.OpenDb())
        {
            Assert.Equal("Orbit", (await db.Servers.SingleAsync()).Name);
            Assert.Equal(auditsBefore, await db.OperatorAuditEntries.CountAsync());
        }
    }

    [Fact]
    public async Task StartupSettingsMatchTheEntrypointWithoutItsExports()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        var domainOnly = new Dictionary<string, string?> { ["STELLARR_DOMAIN"] = "chat.example.com" };
        var publicUrl = await fixture.RunWithEnvironmentAsync(
            domainOnly, "--json", "config", "get", "public-url");
        Assert.Equal(0, publicUrl.ExitCode);
        using (var json = JsonDocument.Parse(publicUrl.Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("https://chat.example.com", item.GetProperty("value").GetString());
            Assert.Equal("environment", item.GetProperty("source").GetString());
        }

        var withPort = new Dictionary<string, string?>
        {
            ["STELLARR_DOMAIN"] = "chat.example.com",
            ["STELLARR_PUBLIC_PORT"] = "9443",
        };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(withPort, "--json", "config", "get", "public-url")).Output))
        {
            Assert.Equal("https://chat.example.com:9443",
                json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }

        var fallbackHost = new Dictionary<string, string?> { ["PUBLIC_HOST"] = "legacy.example" };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(fallbackHost, "--json", "config", "get", "public-url")).Output))
        {
            Assert.Equal("https://legacy.example",
                json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }

        var explicitUrl = new Dictionary<string, string?>
        {
            ["STELLARR_DOMAIN"] = "chat.example.com",
            ["STELLARR_PUBLIC_URL"] = "https://proxy.example/",
        };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(explicitUrl, "--json", "config", "get", "public-url")).Output))
        {
            Assert.Equal("https://proxy.example",
                json.RootElement.GetProperty("data").GetProperty("value").GetString());
        }

        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(domainOnly, "--json", "config", "get", "rtc.public-host")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("chat.example.com", item.GetProperty("value").GetString());
            Assert.Equal("environment", item.GetProperty("source").GetString());
        }

        var storage = new Dictionary<string, string?>
        {
            ["STELLARR_DOMAIN"] = "chat.example.com",
            ["RUSTFS_BUCKET"] = "custom-bucket",
        };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(storage, "--json", "config", "get", "storage.endpoint")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("http://127.0.0.1:9000", item.GetProperty("value").GetString());
            Assert.Equal("entrypoint", item.GetProperty("source").GetString());
        }

        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(storage, "--json", "config", "get", "storage.bucket")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("custom-bucket", item.GetProperty("value").GetString());
            Assert.Equal("environment", item.GetProperty("source").GetString());
        }

        var ignoredBucket = new Dictionary<string, string?> { ["Storage__Bucket"] = "ignored" };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(ignoredBucket, "--json", "config", "get", "storage.bucket")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("stellarr-images", item.GetProperty("value").GetString());
            Assert.Equal("default", item.GetProperty("source").GetString());
        }

        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(
                new Dictionary<string, string?>(),
                "--json", "config", "get", "https-port")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("443", item.GetProperty("value").GetString());
            Assert.Equal("default", item.GetProperty("source").GetString());
        }

        var hostOnlyPort = new Dictionary<string, string?> { ["STELLARR_HTTPS_PORT"] = "8443" };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(hostOnlyPort, "--json", "config", "get", "https-port")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("443", item.GetProperty("value").GetString());
            Assert.Equal("default", item.GetProperty("source").GetString());
        }

        var containerPort = new Dictionary<string, string?> { ["PUBLIC_HTTPS_PORT"] = "9443" };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(containerPort, "--json", "config", "get", "https-port")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal("9443", item.GetProperty("value").GetString());
            Assert.Equal("environment", item.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task NullableIntegrationsKeepPreferenceSourceAndEffectiveAvailabilityApart()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        var set = await fixture.RunWithEnvironmentAsync(
            new Dictionary<string, string?>(),
            "--json", "config", "set", "giphy.enabled", "true", "--yes");
        Assert.Equal(0, set.ExitCode);
        using (var json = JsonDocument.Parse(set.Output))
        {
            var data = json.RootElement.GetProperty("data");
            Assert.True(data.GetProperty("value").GetBoolean());
            Assert.False(data.GetProperty("effectiveValue").GetBoolean());
            Assert.Equal("database", data.GetProperty("source").GetString());
            Assert.NotEmpty(json.RootElement.GetProperty("warnings").EnumerateArray());
        }

        await using (var db = fixture.OpenDb())
        {
            Assert.True((await db.OperationsSettings.SingleAsync()).GiphyEnabled);
        }

        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(
                new Dictionary<string, string?>(),
                "--json", "config", "get", "giphy.enabled")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.True(item.GetProperty("value").GetBoolean());
            Assert.False(item.GetProperty("effectiveValue").GetBoolean());
            Assert.Equal("database", item.GetProperty("source").GetString());
        }

        var withKey = new Dictionary<string, string?> { ["GIPHY_API_KEY"] = "env-giphy" };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(withKey, "--json", "config", "get", "giphy.enabled")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.True(item.GetProperty("value").GetBoolean());
            Assert.True(item.GetProperty("effectiveValue").GetBoolean());
            Assert.Equal("database", item.GetProperty("source").GetString());
        }

        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(
                new Dictionary<string, string?>(),
                "--json", "config", "get", "mail.resend.enabled")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal(JsonValueKind.Null, item.GetProperty("value").ValueKind);
            Assert.False(item.GetProperty("effectiveValue").GetBoolean());
            Assert.Equal("default", item.GetProperty("source").GetString());
        }

        var resend = new Dictionary<string, string?> { ["Mail__ResendApiKey"] = "re_env" };
        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(resend, "--json", "config", "get", "mail.resend.enabled")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal(JsonValueKind.Null, item.GetProperty("value").ValueKind);
            Assert.True(item.GetProperty("effectiveValue").GetBoolean());
            Assert.Equal("default", item.GetProperty("source").GetString());
        }

        using (var json = JsonDocument.Parse(
            (await fixture.RunWithEnvironmentAsync(
                new Dictionary<string, string?>(),
                "--json", "config", "get", "mail.smtp.port")).Output))
        {
            var item = json.RootElement.GetProperty("data");
            Assert.Equal(587, item.GetProperty("value").GetInt32());
            Assert.Equal("database", item.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task ExpiredKeyRingIsReadWithoutCreatingAKey()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();
        var keysDirectory = Path.Combine(fixture.Root, "keys");
        Directory.Delete(keysDirectory, recursive: true);
        Directory.CreateDirectory(keysDirectory);

        var protector = DataProtectionProvider
            .Create(new DirectoryInfo(keysDirectory), builder => builder.SetApplicationName("Stellarr"))
            .CreateProtector("Stellarr.InstanceSecrets.v1", "mail.smtp-password");
        var protectedValue = protector.Protect("old-secret");
        var now = DateTimeOffset.UtcNow;
        foreach (var file in Directory.GetFiles(keysDirectory, "*.xml"))
        {
            var document = XDocument.Load(file);
            SetDate(document, "creationDate", now.AddDays(-120));
            SetDate(document, "activationDate", now.AddDays(-118));
            SetDate(document, "expirationDate", now.AddDays(-28));
            document.Save(file);
        }

        await using (var db = fixture.OpenDb())
        {
            db.InstanceSecrets.Add(new InstanceSecret
            {
                Name = "mail.smtp-password",
                ProtectedValue = protectedValue,
                UpdatedAt = DateTime.UtcNow.AddYears(-1),
            });
            await db.SaveChangesAsync();
        }

        var filesBefore = Directory.GetFiles(keysDirectory, "*.xml")
            .Order()
            .ToDictionary(path => path, File.ReadAllBytes);
        var directRead = Stellarr.Cli.SecretProtection.Persisted(keysDirectory, allowGeneration: false);
        Assert.Equal(
            "old-secret",
            directRead.CreateProtector("Stellarr.InstanceSecrets.v1", "mail.smtp-password")
                .Unprotect(protectedValue));

        var list = await fixture.RunWithEnvironmentAsync(
            new Dictionary<string, string?>(),
            "--json", "secrets", "list");
        Assert.Equal(0, list.ExitCode);
        using (var json = JsonDocument.Parse(list.Output))
        {
            var secret = Assert.Single(
                json.RootElement.GetProperty("data").GetProperty("secrets").EnumerateArray(),
                item => item.GetProperty("name").GetString() == "mail.smtp-password");
            Assert.True(secret.GetProperty("configured").GetBoolean());
            Assert.Equal("database", secret.GetProperty("source").GetString());
        }

        var filesAfter = Directory.GetFiles(keysDirectory, "*.xml")
            .Order()
            .ToDictionary(path => path, File.ReadAllBytes);
        Assert.Equal(filesBefore.Keys, filesAfter.Keys);
        Assert.All(filesBefore, pair => Assert.Equal(
            Convert.ToHexString(SHA256.HashData(pair.Value)),
            Convert.ToHexString(SHA256.HashData(filesAfter[pair.Key]))));
    }

    [Fact]
    public async Task DoctorUsesTheLongestMountAndStatusTreatsAnUnreachableApiAsUnhealthy()
    {
        Assert.Equal(
            "/data/stellarr",
            Stellarr.Cli.StatusCommands.LongestMatchingRoot(
                "/data/stellarr/db/stellarr.db",
                ["/", "/data", "/data/stellarr"]));
        Assert.Equal(
            "/data",
            Stellarr.Cli.StatusCommands.LongestMatchingRoot(
                "/data/stellarr-other/db/stellarr.db",
                ["/", "/data", "/data/stellarr"]));
        Assert.Equal(
            "/",
            Stellarr.Cli.StatusCommands.LongestMatchingRoot(
                "/var/lib/stellarr/db/stellarr.db",
                ["/"]));

        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();
        var environment = new Dictionary<string, string?>
        {
            ["STELLARR_API_URL"] = "http://127.0.0.1:1",
        };

        var status = await fixture.RunWithEnvironmentAsync(
            environment, "--json", "status");
        Assert.Equal(1, status.ExitCode);
        using (var json = JsonDocument.Parse(status.Output))
        {
            Assert.False(json.RootElement.GetProperty("ok").GetBoolean());
            Assert.False(json.RootElement.GetProperty("data").GetProperty("healthy").GetBoolean());
            Assert.False(json.RootElement.GetProperty("data").GetProperty("api").GetProperty("available").GetBoolean());
        }

        var doctor = await fixture.RunWithEnvironmentAsync(
            environment, "--json", "doctor");
        Assert.Equal(0, doctor.ExitCode);
        using (var json = JsonDocument.Parse(doctor.Output))
        {
            var localApi = Assert.Single(
                json.RootElement.GetProperty("data").GetProperty("checks").EnumerateArray(),
                check => check.GetProperty("name").GetString() == "local-api");
            Assert.Equal("warn", localApi.GetProperty("status").GetString());
        }
    }

    [Fact]
    public async Task UnconfirmedOrCancelledMutationsChangeNothing()
    {
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        var closed = await fixture.RunAsync(
            "--json", "config", "set", "time-zone", "Europe/Warsaw");
        Assert.Equal(2, closed.ExitCode);
        using (var json = JsonDocument.Parse(closed.Output))
        {
            Assert.Equal("confirmation_required", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        var cancelled = await fixture.RunInteractiveAsync(
            "n\n", "--json", "config", "set", "time-zone", "Europe/Warsaw");
        Assert.Equal(2, cancelled.ExitCode);
        using (var json = JsonDocument.Parse(cancelled.Output))
        {
            Assert.Equal("cancelled", json.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        await using var db = fixture.OpenDb();
        Assert.Empty(await db.OperationsSettings.ToArrayAsync());
        Assert.Empty(await db.OperatorAuditEntries.ToArrayAsync());
    }

    [Fact]
    public async Task SecretsUseTheExistingKeyRingAndNeverReachOutput()
    {
        const string secret = " super-secret ";
        using var fixture = await CliFixture.StartAsync();
        fixture.Stop();

        var set = await fixture.RunWithStdinAsync(
            $"{secret}\n", "secrets", "set", "mail.smtp-password", "--stdin", "--yes", "--json");
        Assert.True(set.ExitCode == 0, set.Error);
        Assert.DoesNotContain("super-secret", set.Output, StringComparison.Ordinal);
        Assert.DoesNotContain("super-secret", set.Error, StringComparison.Ordinal);

        var keyDirectory = new DirectoryInfo(Path.Combine(fixture.Root, "keys"));
        var protector = DataProtectionProvider
            .Create(keyDirectory, builder => builder.SetApplicationName("Stellarr"))
            .CreateProtector("Stellarr.InstanceSecrets.v1", "mail.smtp-password");
        await using (var db = fixture.OpenDb())
        {
            var row = await db.InstanceSecrets.SingleAsync();
            Assert.Equal("mail.smtp-password", row.Name);
            Assert.DoesNotContain("super-secret", row.ProtectedValue, StringComparison.Ordinal);
            Assert.Equal(secret, protector.Unprotect(row.ProtectedValue));
            var audit = await db.OperatorAuditEntries.SingleAsync();
            Assert.Equal("secrets.set", audit.Operation);
            Assert.Equal("mail.smtp-password", audit.Target);
        }

        var keyFileCount = Directory.GetFiles(Path.Combine(fixture.Root, "keys"), "*.xml").Length;
        var list = await fixture.RunAsync("--json", "secrets", "list");
        Assert.Equal(0, list.ExitCode);
        Assert.DoesNotContain("super-secret", list.Output, StringComparison.Ordinal);
        Assert.Contains("mail.smtp-password", list.Output, StringComparison.Ordinal);
        using (var json = JsonDocument.Parse(list.Output))
        {
            var listedSecret = Assert.Single(
                json.RootElement.GetProperty("data").GetProperty("secrets").EnumerateArray(),
                item => item.GetProperty("name").GetString() == "mail.smtp-password");
            Assert.Equal("database", listedSecret.GetProperty("source").GetString());
        }

        Assert.Equal(keyFileCount, Directory.GetFiles(Path.Combine(fixture.Root, "keys"), "*.xml").Length);

        var clear = await fixture.RunAsync("--json", "secrets", "clear", "mail.smtp-password", "--yes");
        Assert.Equal(0, clear.ExitCode);
        Assert.DoesNotContain("super-secret", clear.Output, StringComparison.Ordinal);

        await using (var db = fixture.OpenDb())
        {
            Assert.Empty(await db.InstanceSecrets.ToArrayAsync());
            Assert.Equal(2, await db.OperatorAuditEntries.CountAsync());
        }
    }

    [Fact]
    public async Task UsersAndSessionsExposeAdministrativeMetadataOnly()
    {
        using var fixture = await CliFixture.StartAsync();
        string passwordHash;
        Guid sessionId;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            passwordHash = user.PasswordHash;
            sessionId = Guid.NewGuid();
            db.UserSessions.Add(new UserSession
            {
                Id = sessionId,
                UserId = user.Id,
                Device = "TestBrowser/1.0",
                IpAddress = "192.0.2.10",
                CreatedAt = DateTime.UtcNow,
                LastSeenAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(1),
            });
            await db.SaveChangesAsync();
        }
        fixture.Stop();

        var users = await fixture.RunAsync("--json", "users", "list");
        Assert.Equal(0, users.ExitCode);
        Assert.DoesNotContain(passwordHash, users.Output, StringComparison.Ordinal);
        using (var json = JsonDocument.Parse(users.Output))
        {
            Assert.Contains(
                json.RootElement.GetProperty("data").GetProperty("users").EnumerateArray(),
                user => user.GetProperty("username").GetString() == "jo");
        }

        var sessions = await fixture.RunAsync("--json", "sessions", "list", "--user", "jo");
        Assert.Equal(0, sessions.ExitCode);
        using (var json = JsonDocument.Parse(sessions.Output))
        {
            var listed = Assert.Single(json.RootElement.GetProperty("data").GetProperty("sessions").EnumerateArray());
            Assert.Equal(sessionId.ToString(), listed.GetProperty("id").GetString());
            Assert.Equal("TestBrowser/1.0", listed.GetProperty("device").GetString());
            Assert.False(sessions.Output.Contains("cookie", StringComparison.OrdinalIgnoreCase));
        }

        var revoke = await fixture.RunAsync("--json", "sessions", "revoke", sessionId.ToString(), "--yes");
        Assert.Equal(0, revoke.ExitCode);
        Assert.Contains("deferred", revoke.Output, StringComparison.OrdinalIgnoreCase);
        await using (var db = fixture.OpenDb())
        {
            Assert.NotNull((await db.UserSessions.SingleAsync(x => x.Id == sessionId)).RevokedAt);
            Assert.Equal("sessions.revoke", (await db.OperatorAuditEntries.SingleAsync()).Operation);
        }
    }

    [Fact]
    public async Task RevokeAllInvalidatesSessionsAndApprovedDesktopHandoffs()
    {
        using var fixture = await CliFixture.StartAsync();
        Guid first;
        Guid second;
        Guid handoff;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(x => x.Username == "jo");
            first = Guid.NewGuid();
            second = Guid.NewGuid();
            handoff = Guid.NewGuid();
            var now = DateTime.UtcNow;
            db.UserSessions.AddRange(
                new UserSession
                {
                    Id = first,
                    UserId = user.Id,
                    Device = "First",
                    IpAddress = "192.0.2.1",
                    CreatedAt = now,
                    LastSeenAt = now,
                    ExpiresAt = now.AddDays(1),
                },
                new UserSession
                {
                    Id = second,
                    UserId = user.Id,
                    Device = "Second",
                    IpAddress = "192.0.2.2",
                    CreatedAt = now,
                    LastSeenAt = now,
                    ExpiresAt = now.AddDays(1),
                });
            db.DesktopBrowserLogins.Add(new DesktopBrowserLogin
            {
                Id = handoff,
                SecretHash = new string('a', 64),
                UserId = user.Id,
                CreatedAt = now,
                ExpiresAt = now.AddMinutes(2),
                ApprovedAt = now,
            });
            await db.SaveChangesAsync();
        }
        fixture.Stop();

        var result = await fixture.RunAsync(
            "--json", "sessions", "revoke", "--user", "jo", "--all", "--yes");
        Assert.Equal(0, result.ExitCode);
        using (var json = JsonDocument.Parse(result.Output))
        {
            var data = json.RootElement.GetProperty("data");
            Assert.Equal(2, data.GetProperty("sessionsRevoked").GetInt32());
            Assert.Equal(1, data.GetProperty("handoffsInvalidated").GetInt32());
            Assert.True(data.GetProperty("realtimeDisconnectDeferred").GetBoolean());
        }

        await using (var db = fixture.OpenDb())
        {
            Assert.All(await db.UserSessions.ToArrayAsync(), session => Assert.NotNull(session.RevokedAt));
            Assert.NotNull((await db.DesktopBrowserLogins.SingleAsync(x => x.Id == handoff)).RedeemedAt);
            var audit = await db.OperatorAuditEntries.SingleAsync();
            Assert.Equal("sessions.revoke-all", audit.Operation);
            Assert.Equal("local-cli", audit.Actor);
        }
    }

    private static void SetDate(XDocument document, string name, DateTimeOffset value)
    {
        var element = document.Descendants().Single(candidate => candidate.Name.LocalName == name);
        element.Value = value.ToUniversalTime().ToString("O");
    }
}

/// <summary>A seeded instance that can be stopped and then operated on by the CLI, like docker exec.</summary>
internal sealed class CliFixture : IDisposable
{
    private readonly StellarrWebApplicationFactory? _factory;

    private CliFixture(string root, StellarrWebApplicationFactory? factory)
    {
        Root = root;
        _factory = factory;
    }

    internal string Root { get; }

    internal StellarrWebApplicationFactory Factory =>
        _factory ?? throw new InvalidOperationException("The fixture has been stopped.");

    internal static CliFixture CreateUnstarted()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stellarr-cli-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        return new CliFixture(root, null);
    }

    internal static async Task<CliFixture> StartAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), $"stellarr-cli-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Path.Combine(root, "db"));
        var factory = new StellarrWebApplicationFactory(
            loadTestData: true,
            databasePath: Path.Combine(root, "db", "stellarr.db"),
            dataRoot: root,
            deleteStorageOnDispose: false);
        using (var client = factory.CreateClient())
        {
            _ = await client.GetAsync("/health/ready");
        }

        // WebApplicationFactory sees Program's DataRoot too late to redirect its
        // key ring, so the fixture lays down the same application key ring the
        // container would have under the data root the CLI is given.
        var keyDirectory = Path.Combine(root, "keys");
        Directory.CreateDirectory(keyDirectory);
        var protector = DataProtectionProvider
            .Create(new DirectoryInfo(keyDirectory), builder => builder.SetApplicationName("Stellarr"))
            .CreateProtector("Stellarr.InstanceSecrets.v1", "test");
        _ = protector.Protect("warm-up");
        return new CliFixture(root, factory);
    }

    internal void Stop() => _factory?.Dispose();

    internal AppDbContext OpenDb() => new(
        new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={Path.Combine(Root, "db", "stellarr.db")};Mode=ReadWrite;Pooling=False")
            .Options);

    internal async Task<CliRun> RunAsync(params string[] args) =>
        await RunCommandAsync("", interactive: false, args, environment: null);

    internal async Task<CliRun> RunWithStdinAsync(string stdin, params string[] args) =>
        await RunCommandAsync(stdin, interactive: false, args, environment: null);

    internal async Task<CliRun> RunInteractiveAsync(string stdin, params string[] args) =>
        await RunCommandAsync(stdin, interactive: true, args, environment: null);

    internal async Task<CliRun> RunWithEnvironmentAsync(
        IReadOnlyDictionary<string, string?> environment,
        params string[] args) =>
        await RunCommandAsync("", interactive: false, args, environment);

    private async Task<CliRun> RunCommandAsync(
        string stdin,
        bool interactive,
        string[] args,
        IReadOnlyDictionary<string, string?>? environment)
    {
        var withRoot = new[] { "--data-root", Root }.Concat(args).ToArray();
        using var output = new StringWriter();
        using var error = new StringWriter();
        var exit = await Stellarr.Cli.CliApplication.RunAsync(
            withRoot,
            new StringReader(stdin),
            output,
            error,
            interactive,
            secretPrompt: null,
            CancellationToken.None,
            environment);
        return new CliRun(exit, output.ToString(), error.ToString());
    }

    public void Dispose()
    {
        Stop();
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(Root))
        {
            Directory.Delete(Root, recursive: true);
        }
    }
}

internal sealed record CliRun(int ExitCode, string Output, string Error);
