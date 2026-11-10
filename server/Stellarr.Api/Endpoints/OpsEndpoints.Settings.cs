using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Mail;

namespace Stellarr.Api.Endpoints;

// What the operator configures: instance settings, required client versions and mail.
public static partial class OpsEndpoints
{
    private const int MaxRetentionDays = 3650;
    private const int MaxMailAddressLength = 320;

    private static async Task<IResult> GetSettingsAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        IOptions<MailOptions> mail,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        return Results.Ok(settings.ToOpsDto(server.Name, HasResendApiKey(mail.Value)));
    }

    private static async Task<IResult> UpdateSettingsAsync(
        UpdateOpsSettingsRequest request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        IOptions<MailOptions> mail,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var problems = ValidateSettings(request);
        if (problems.Count > 0)
        {
            return Results.ValidationProblem(problems);
        }

        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        server.Name = request.InstanceName?.Trim() ?? "";
        settings.PublicUrl = request.PublicUrl?.Trim() ?? "";
        settings.TimeZone = request.TimeZone?.Trim() ?? "";
        settings.MailingEnabled = request.MailingEnabled;
        settings.MailFromAddress = request.MailFromAddress?.Trim() ?? "";
        settings.InviteMailEnabled = request.InviteMailEnabled;
        settings.RecoveryMailEnabled = request.RecoveryMailEnabled;
        settings.AlertMailEnabled = request.AlertMailEnabled;
        settings.BackupRetentionDays = request.BackupRetentionDays;
        settings.LogRetentionDays = request.LogRetentionDays;
        settings.OrphanObjectRetentionDays = request.OrphanObjectRetentionDays;
        settings.AutomaticCleanupEnabled = request.AutomaticCleanupEnabled;
        settings.UpdatedAt = DateTime.UtcNow;
        await StageAuditAsync(
            db, server.Id, http.User.RequireUserId(), "zaktualizował(a) ustawienia OPs", cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Ok(settings.ToOpsDto(server.Name, HasResendApiKey(mail.Value)));
    }

    private static async Task<IResult> GetDesktopReleaseAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        CancellationToken cancellationToken)
    {
        var settings = await LoadSettingsAsync(db, http.RequireInstanceServer(), configuration, cancellationToken);
        return DescribeReleases(
            settings, configuration, desktop, android, "Manifest wydania aplikacji wymaga naprawy.");
    }

    private static async Task<IResult> UpdateDesktopReleaseAsync(
        UpdateOpsDesktopReleaseRequest request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var minimum = request.MinimumVersion?.Trim() ?? "";
        var recommended = request.RecommendedVersion?.Trim() ?? "";
        var problems = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (!DesktopReleaseEndpoints.TryParseStableVersion(minimum, out var minimumVersion))
        {
            problems["minimumVersion"] = ["Podaj stabilną wersję w formacie major.minor.patch."];
        }

        if (!DesktopReleaseEndpoints.TryParseStableVersion(recommended, out var recommendedVersion))
        {
            problems["recommendedVersion"] = ["Podaj stabilną wersję w formacie major.minor.patch."];
        }

        if (problems.Count == 0 && minimumVersion > recommendedVersion)
        {
            problems["recommendedVersion"] = ["Wersja zalecana nie może być niższa od minimalnej."];
        }

        if (problems.Count > 0)
        {
            return Results.ValidationProblem(problems);
        }

        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        settings.DesktopMinimumVersion = minimum;
        settings.DesktopRecommendedVersion = recommended;
        settings.UpdatedAt = DateTime.UtcNow;
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            $"ustawił(a) wersje desktopu: minimum {minimum}, zalecana {recommended}",
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return DescribeReleases(
            settings,
            configuration,
            desktop,
            android,
            "Wersje zapisano, ale manifest wydania aplikacji wymaga naprawy.");
    }

    private static async Task<IResult> SendTestMailAsync(
        TestMailRequest request,
        HttpContext http,
        AppDbContext db,
        IEmailDelivery delivery,
        IOptions<MailOptions> mail,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var recipient = request.To?.Trim() ?? "";
        if (recipient.Length > MaxMailAddressLength ||
            !MailAddress.TryCreate(recipient, out var parsed) ||
            !string.Equals(parsed.Address, recipient, StringComparison.OrdinalIgnoreCase))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["to"] = ["Podaj poprawny adres odbiorcy."],
            });
        }

        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        var options = mail.Value;
        var fromAddress = string.IsNullOrWhiteSpace(settings.MailFromAddress)
            ? options.FromAddress.Trim()
            : settings.MailFromAddress.Trim();
        if (!settings.MailingEnabled || fromAddress.Length == 0 || !HasResendApiKey(options))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Resend nie jest gotowy",
                detail: "Włącz mailing, ustaw adres nadawcy i dodaj Mail__ResendApiKey w środowisku backendu.");
        }

        var from = string.IsNullOrWhiteSpace(options.FromName)
            ? fromAddress
            : $"{options.FromName.Trim()} <{fromAddress}>";
        var messageId = await delivery.SendAsync(
            AccountEmail.DeliveryTest(from, recipient, server.Name),
            cancellationToken);
        return Results.Ok(new { id = messageId });
    }

    /// <summary>
    /// The settings row of the instance server. Before the operator has saved
    /// anything there is none, and the defaults of this installation stand in
    /// for it: they are added to <paramref name="db"/>, so they are stored only
    /// when the caller saves.
    /// </summary>
    private static async Task<OperationsSettings> LoadSettingsAsync(
        AppDbContext db,
        StellarrServer server,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var settings = await db.OperationsSettings
            .SingleOrDefaultAsync(x => x.ServerId == server.Id, cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        settings = new OperationsSettings
        {
            ServerId = server.Id,
            PublicUrl = configuration["Operations:PublicUrl"]?.Trim() ?? "",
            TimeZone = configuration["Operations:TimeZone"]?.Trim() ?? TimeZoneInfo.Local.Id,
            MailingEnabled = configuration.GetValue<bool>("Mail:Enabled"),
            MailFromAddress = configuration["Mail:FromAddress"]?.Trim() ?? "",
            InviteMailEnabled = true,
            RecoveryMailEnabled = true,
            BackupRetentionDays = DefaultBackupRetentionDays,
            LogRetentionDays = 30,
            OrphanObjectRetentionDays = 1,
            AutomaticCleanupEnabled = true,
            UpdatedAt = server.CreatedAt,
        };
        db.OperationsSettings.Add(settings);
        return settings;
    }

    /// <summary>
    /// The versions in force, with the packages published for download. A
    /// broken release manifest turns into a 503 that says what to repair.
    /// </summary>
    private static IResult DescribeReleases(
        OperationsSettings settings,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        string brokenManifestTitle)
    {
        try
        {
            return Results.Ok(new OpsDesktopReleaseDto(
                ClientDiscoveryEndpoints.DesktopVersion(
                    settings.DesktopMinimumVersion, configuration, "Desktop:MinimumVersion"),
                ClientDiscoveryEndpoints.DesktopVersion(
                    settings.DesktopRecommendedVersion, configuration, "Desktop:RecommendedVersion"),
                desktop.Current()?.ToDto(),
                android.Current()?.ToDto()));
        }
        catch (InvalidDataException)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: brokenManifestTitle);
        }
    }

    /// <summary>The key itself is never read back; whether one is set is all the panel learns.</summary>
    private static bool HasResendApiKey(MailOptions options) => !string.IsNullOrWhiteSpace(options.ResendApiKey);

    private static Dictionary<string, string[]> ValidateSettings(UpdateOpsSettingsRequest request)
    {
        var problems = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if ((request.InstanceName?.Trim() ?? "").Length is < 1 or > 80)
        {
            problems["instanceName"] = ["Nazwa instancji musi mieć od 1 do 80 znaków."];
        }

        var publicUrl = request.PublicUrl?.Trim() ?? "";
        if (!Uri.TryCreate(publicUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback)) ||
            uri.UserInfo.Length > 0)
        {
            problems["publicUrl"] = ["Podaj bezwzględny adres HTTPS. HTTP jest dozwolone tylko dla localhost."];
        }

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(request.TimeZone?.Trim() ?? "");
        }
        catch (TimeZoneNotFoundException)
        {
            problems["timeZone"] = ["Ta strefa czasowa nie jest dostępna na serwerze."];
        }
        catch (InvalidTimeZoneException)
        {
            problems["timeZone"] = ["Konfiguracja strefy czasowej na serwerze jest nieprawidłowa."];
        }

        var fromAddress = request.MailFromAddress?.Trim() ?? "";
        if (fromAddress.Length > MaxMailAddressLength ||
            (request.MailingEnabled && !MailAddress.TryCreate(fromAddress, out _)))
        {
            problems["mailFromAddress"] = ["Włączony mailing wymaga poprawnego adresu nadawcy."];
        }

        if (request.BackupRetentionDays is < 1 or > MaxRetentionDays)
        {
            problems["backupRetentionDays"] = ["Retencja backupów musi wynosić od 1 do 3650 dni."];
        }

        if (request.LogRetentionDays is < 1 or > MaxRetentionDays)
        {
            problems["logRetentionDays"] = ["Retencja logów musi wynosić od 1 do 3650 dni."];
        }

        if (request.OrphanObjectRetentionDays is < 1 or > MaxRetentionDays)
        {
            problems["orphanObjectRetentionDays"] = ["Retencja osieroconych obiektów musi wynosić od 1 do 3650 dni."];
        }

        return problems;
    }
}
