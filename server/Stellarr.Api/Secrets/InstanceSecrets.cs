using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Secrets;

/// <summary>Where the value of a secret comes from.</summary>
public enum SecretSource
{
    None,
    Panel,
    Environment,
}

/// <summary>A secret's value and where it came from; empty when it is set nowhere.</summary>
public sealed record SecretValue(string Value, SecretSource Source)
{
    public static readonly SecretValue Missing = new("", SecretSource.None);

    public bool IsSet => Source != SecretSource.None;

    // A record prints its members; this one must never print its value.
    public override string ToString() => $"SecretValue {{ Source = {Source} }}";
}

/// <summary>
/// A secret Cockpit can hold. <c>Setting</c> is the configuration key it falls
/// back to and <c>Variable</c> the name an operator sets in <c>.env</c>.
/// Passwords keep their spaces; keys are trimmed.
/// </summary>
public sealed record SecretDefinition(string Name, string Setting, string Variable, bool Trim);

public static class SecretNames
{
    public const string ResendApiKey = "mail.resend-api-key";
    public const string SmtpPassword = "mail.smtp-password";
    public const string GiphyApiKey = "giphy.api-key";
    public const string BackupAccessKey = "backups.access-key";
    public const string BackupSecretKey = "backups.secret-key";

    /// <summary>The longest value a secret may hold.</summary>
    public const int MaxLength = 4096;

    public static readonly IReadOnlyList<SecretDefinition> All =
    [
        new(ResendApiKey, "Mail:ResendApiKey", "STELLARR_RESEND_API_KEY", Trim: true),
        new(SmtpPassword, "Mail:SmtpPassword", "STELLARR_SMTP_PASSWORD", Trim: false),
        new(GiphyApiKey, "GIPHY_API_KEY", "GIPHY_API_KEY", Trim: true),
        new(BackupAccessKey, "Backups:Destination:AccessKey", "STELLARR_BACKUP_ACCESS_KEY", Trim: true),
        new(BackupSecretKey, "Backups:Destination:SecretKey", "STELLARR_BACKUP_SECRET_KEY", Trim: true),
    ];

    public static SecretDefinition? Find(string name) => All.FirstOrDefault(x => x.Name == name);

    /// <summary>The rule Cockpit and the operator CLI both apply before storing a value.</summary>
    public static bool IsValidValue(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= MaxLength;
}

/// <summary>Every secret Cockpit holds, resolved.</summary>
public sealed record ResolvedSecrets(IReadOnlyDictionary<string, SecretValue> Values, IReadOnlyDictionary<string, DateTime> PanelUpdatedAt)
{
    public SecretValue this[string name] => Values.TryGetValue(name, out var value) ? value : SecretValue.Missing;

    public SecretValue ResendApiKey => this[SecretNames.ResendApiKey];

    public SecretValue SmtpPassword => this[SecretNames.SmtpPassword];

    public SecretValue GiphyApiKey => this[SecretNames.GiphyApiKey];
}

/// <summary>
/// Reads and writes the secrets an operator sets in Cockpit. A value set in the
/// panel wins; without one, the environment's value stands. Values only go in:
/// nothing here hands one back to a client, and nothing logs one.
/// </summary>
public sealed partial class InstanceSecrets(
    AppDbContext db,
    IDataProtectionProvider protection,
    IConfiguration configuration,
    ILogger<InstanceSecrets> logger)
{
    private const string Purpose = "Stellarr.InstanceSecrets.v1";

    public async Task<ResolvedSecrets> ReadAsync(CancellationToken cancellationToken)
    {
        var rows = await db.InstanceSecrets.AsNoTracking().ToListAsync(cancellationToken);
        var values = new Dictionary<string, SecretValue>();
        var updated = new Dictionary<string, DateTime>();
        foreach (var definition in SecretNames.All)
        {
            var row = rows.FirstOrDefault(x => x.Name == definition.Name);
            var panel = row is null ? null : Unprotect(definition.Name, row.ProtectedValue);
            if (!string.IsNullOrEmpty(panel))
            {
                values[definition.Name] = new SecretValue(panel, SecretSource.Panel);
                updated[definition.Name] = row!.UpdatedAt;
                continue;
            }

            var environment = configuration[definition.Setting] ?? "";
            if (definition.Trim)
            {
                environment = environment.Trim();
            }

            values[definition.Name] = environment.Length > 0
                ? new SecretValue(environment, SecretSource.Environment)
                : SecretValue.Missing;
        }

        return new ResolvedSecrets(values, updated);
    }

    /// <summary>Stores <paramref name="value"/> for <paramref name="definition"/>; the caller saves.</summary>
    public async Task SetAsync(SecretDefinition definition, string value, CancellationToken cancellationToken)
    {
        var stored = definition.Trim ? value.Trim() : value;
        var row = await db.InstanceSecrets.SingleOrDefaultAsync(x => x.Name == definition.Name, cancellationToken);
        var protectedValue = Protector(definition.Name).Protect(stored);
        if (row is null)
        {
            db.InstanceSecrets.Add(new InstanceSecret
            {
                Name = definition.Name,
                ProtectedValue = protectedValue,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            row.ProtectedValue = protectedValue;
            row.UpdatedAt = DateTime.UtcNow;
        }
    }

    /// <summary>Removes the panel's value, so the environment's stands again; the caller saves.</summary>
    public async Task ClearAsync(SecretDefinition definition, CancellationToken cancellationToken)
    {
        var row = await db.InstanceSecrets.SingleOrDefaultAsync(x => x.Name == definition.Name, cancellationToken);
        if (row is not null)
        {
            db.InstanceSecrets.Remove(row);
        }
    }

    private IDataProtector Protector(string name) => protection.CreateProtector(Purpose, name);

    /// <summary>
    /// The plain value, or null when the keys that encrypted it are gone (a lost
    /// keys directory, a database moved without it): such a secret reads as unset.
    /// </summary>
    private string? Unprotect(string name, string protectedValue)
    {
        try
        {
            return Protector(name).Unprotect(protectedValue);
        }
        catch (CryptographicException)
        {
            LogUndecryptable(logger, name);
            return null;
        }
    }

    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The secret {SecretName} set in Cockpit cannot be decrypted with this instance's keys; it counts as unset")]
    private static partial void LogUndecryptable(ILogger logger, string secretName);
}
