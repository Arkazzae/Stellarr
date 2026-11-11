using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

// What the operator configures: instance settings, required client versions and mail.
public static partial class CockpitEndpoints
{
    private const int MaxRetentionDays = 3650;
    private const int MaxMailAddressLength = 320;

    private static async Task<IResult> GetSettingsAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        InstanceSecrets secrets,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        return Results.Ok(settings.ToCockpitDto(
            server.Name,
            PublicUrlOf(configuration),
            await secrets.ReadAsync(cancellationToken)));
    }

    private static async Task<IResult> UpdateSettingsAsync(
        UpdateCockpitSettingsRequest request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        InstanceSecrets secrets,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var problems = ValidateSettings(request, messages);
        if (problems.Count > 0)
        {
            return Results.ValidationProblem(problems);
        }

        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        server.Name = request.InstanceName?.Trim() ?? "";
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
        // The mail transport fields are left as they are when a request leaves them out.
        settings.MailSmtpHost = request.SmtpHost?.Trim() ?? settings.MailSmtpHost;
        settings.MailSmtpPort = request.SmtpPort ?? settings.MailSmtpPort;
        settings.MailSmtpSecurity = request.SmtpSecurity?.Trim().ToLowerInvariant() ?? settings.MailSmtpSecurity;
        settings.MailSmtpUsername = request.SmtpUsername?.Trim() ?? settings.MailSmtpUsername;
        settings.MailResendEnabled = request.ResendEnabled ?? settings.MailResendEnabled;
        settings.GiphyEnabled = request.GiphyEnabled ?? settings.GiphyEnabled;
        settings.UpdatedAt = DateTime.UtcNow;
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditSettingsUpdated),
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Ok(settings.ToCockpitDto(
            server.Name,
            PublicUrlOf(configuration),
            await secrets.ReadAsync(cancellationToken)));
    }

    private static async Task<IResult> GetDesktopReleaseAsync(
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var settings = await LoadSettingsAsync(db, http.RequireInstanceServer(), configuration, cancellationToken);
        return DescribeReleases(
            settings, configuration, desktop, android, messages.Get(MessageKey.CockpitReleaseManifestBroken));
    }

    private static async Task<IResult> UpdateDesktopReleaseAsync(
        UpdateCockpitDesktopReleaseRequest request,
        HttpContext http,
        AppDbContext db,
        IConfiguration configuration,
        DesktopReleaseCatalogue desktop,
        AndroidReleaseCatalogue android,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var minimum = request.MinimumVersion?.Trim() ?? "";
        var recommended = request.RecommendedVersion?.Trim() ?? "";
        var problems = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (!DesktopReleaseEndpoints.TryParseStableVersion(minimum, out var minimumVersion))
        {
            problems["minimumVersion"] = [messages.Get(MessageKey.CockpitVersionInvalid)];
        }

        if (!DesktopReleaseEndpoints.TryParseStableVersion(recommended, out var recommendedVersion))
        {
            problems["recommendedVersion"] = [messages.Get(MessageKey.CockpitVersionInvalid)];
        }

        if (problems.Count == 0 && minimumVersion > recommendedVersion)
        {
            problems["recommendedVersion"] = [messages.Get(MessageKey.CockpitRecommendedBelowMinimum)];
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
            messages.Get(MessageKey.AuditDesktopVersionsSet, ("minimum", minimum), ("recommended", recommended)),
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
            messages.Get(MessageKey.CockpitVersionsSavedManifestBroken));
    }

    private static async Task<IResult> SendTestMailAsync(
        TestMailRequest request,
        HttpContext http,
        AppDbContext db,
        IEmailDelivery delivery,
        IOptions<MailOptions> mail,
        InstanceSecrets secrets,
        IConfiguration configuration,
        Messages messages,
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
                ["to"] = [messages.Get(MessageKey.CockpitTestMailRecipientInvalid)],
            });
        }

        var settings = await LoadSettingsAsync(db, server, configuration, cancellationToken);
        var options = mail.Value;
        var transport = MailTransports.Resolve(settings, await secrets.ReadAsync(cancellationToken));
        var fromAddress = string.IsNullOrWhiteSpace(settings.MailFromAddress)
            ? options.FromAddress.Trim()
            : settings.MailFromAddress.Trim();
        if (!settings.MailingEnabled || fromAddress.Length == 0 || !transport.Ready)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitMailNotReadyTitle),
                detail: messages.Get(transport.Provider == MailProvider.Resend
                    ? MessageKey.CockpitMailNotReadyDetail
                    : MessageKey.CockpitMailNotReadySmtpDetail));
        }

        var from = string.IsNullOrWhiteSpace(options.FromName)
            ? fromAddress
            : $"{options.FromName.Trim()} <{fromAddress}>";
        try
        {
            var messageId = await delivery.SendAsync(
                AccountEmail.DeliveryTest(from, recipient, server.Name, messages),
                transport,
                cancellationToken);
            return Results.Ok(new { id = messageId, provider = MailTransports.NameOf(transport.Provider) });
        }
        catch (Exception exception) when (exception is MailDeliveryException or HttpRequestException)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status502BadGateway,
                title: messages.Get(MessageKey.CockpitTestMailFailed),
                detail: exception.Message);
        }
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
            return Results.Ok(new CockpitDesktopReleaseDto(
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

    /// <summary>
    /// The address people reach the instance at. It comes from the environment
    /// (STELLARR_DOMAIN, through the container's entrypoint) and nothing in
    /// Cockpit overrides it.
    /// </summary>
    internal static string PublicUrlOf(IConfiguration configuration) =>
        (configuration["Operations:PublicUrl"] ?? "").Trim().TrimEnd('/');

    private static Dictionary<string, string[]> ValidateSettings(UpdateCockpitSettingsRequest request, Messages messages)
    {
        var problems = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if ((request.InstanceName?.Trim() ?? "").Length is < 1 or > 80)
        {
            problems["instanceName"] = [messages.Get(MessageKey.CockpitInstanceNameLength)];
        }


        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(request.TimeZone?.Trim() ?? "");
        }
        catch (TimeZoneNotFoundException)
        {
            problems["timeZone"] = [messages.Get(MessageKey.CockpitTimeZoneUnavailable)];
        }
        catch (InvalidTimeZoneException)
        {
            problems["timeZone"] = [messages.Get(MessageKey.CockpitTimeZoneBroken)];
        }

        if ((request.SmtpHost?.Trim().Length ?? 0) > 255)
        {
            problems["smtpHost"] = [messages.Get(MessageKey.CockpitSmtpHostLength)];
        }

        if (request.SmtpPort is < 1 or > 65535)
        {
            problems["smtpPort"] = [messages.Get(MessageKey.CockpitSmtpPortRange)];
        }

        if (request.SmtpSecurity is { } security &&
            !MailTransports.SecurityNames.Contains(security.Trim().ToLowerInvariant()))
        {
            problems["smtpSecurity"] = [messages.Get(MessageKey.CockpitSmtpSecurityUnknown)];
        }

        if ((request.SmtpUsername?.Trim().Length ?? 0) > MaxMailAddressLength)
        {
            problems["smtpUsername"] = [messages.Get(MessageKey.CockpitSmtpUsernameLength)];
        }

        var fromAddress = request.MailFromAddress?.Trim() ?? "";
        if (fromAddress.Length > MaxMailAddressLength ||
            (request.MailingEnabled && !MailAddress.TryCreate(fromAddress, out _)))
        {
            problems["mailFromAddress"] = [messages.Get(MessageKey.CockpitMailFromRequired)];
        }

        if (request.BackupRetentionDays is < 1 or > MaxRetentionDays)
        {
            problems["backupRetentionDays"] = [messages.Get(MessageKey.CockpitBackupRetentionRange, ("max", MaxRetentionDays))];
        }

        if (request.LogRetentionDays is < 1 or > MaxRetentionDays)
        {
            problems["logRetentionDays"] = [messages.Get(MessageKey.CockpitLogRetentionRange, ("max", MaxRetentionDays))];
        }

        if (request.OrphanObjectRetentionDays is < 1 or > MaxRetentionDays)
        {
            problems["orphanObjectRetentionDays"] = [messages.Get(MessageKey.CockpitOrphanRetentionRange, ("max", MaxRetentionDays))];
        }

        return problems;
    }
}
