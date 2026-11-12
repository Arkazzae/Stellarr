using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Mail;

namespace Stellarr.Api.Operations;

/// <summary>
/// The defaults, validation and update rules of the settings Cockpit and the
/// operator CLI both write. Keeping them here means a command run in a
/// container cannot accept a value Cockpit would reject, or seed a new row with
/// different values.
/// </summary>
public static class InstanceSettingsService
{
    public const int MaxRetentionDays = 3650;
    public const int MaxMailAddressLength = 320;
    public const int DefaultBackupRetentionDays = 14;

    /// <summary>
    /// The settings row of the instance server. Before the operator has saved
    /// anything there is none, and the defaults of this installation stand in
    /// for it: they are added to <paramref name="db"/>, so they are stored only
    /// when the caller saves.
    /// </summary>
    public static async Task<OperationsSettings> LoadAsync(
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

    /// <summary>The request that changes nothing, so one field can be replaced before validation.</summary>
    public static UpdateCockpitSettingsRequest Snapshot(StellarrServer server, OperationsSettings settings) => new(
        server.Name,
        settings.TimeZone,
        settings.MailingEnabled,
        settings.MailFromAddress,
        settings.InviteMailEnabled,
        settings.RecoveryMailEnabled,
        settings.AlertMailEnabled,
        settings.BackupRetentionDays,
        settings.LogRetentionDays,
        settings.OrphanObjectRetentionDays,
        settings.AutomaticCleanupEnabled,
        settings.MailSmtpHost,
        settings.MailSmtpPort,
        settings.MailSmtpSecurity,
        settings.MailSmtpUsername,
        settings.MailResendEnabled,
        settings.GiphyEnabled);

    /// <summary>Applies a validated request. The caller stages the audit and saves.</summary>
    public static void Apply(
        OperationsSettings settings,
        StellarrServer server,
        UpdateCockpitSettingsRequest request)
    {
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
    }

    public static Dictionary<string, string[]> Validate(
        UpdateCockpitSettingsRequest request,
        Messages messages)
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
