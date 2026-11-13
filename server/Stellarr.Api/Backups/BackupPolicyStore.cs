using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Backups;

/// <summary>Non-secret schedule policy overridden in Cockpit.</summary>
public sealed record BackupPolicyRequest(
    bool Enabled, int IntervalHours, int RetryMinutes, int InitialDelayMinutes, int RetentionDays);

public sealed record BackupPolicyDto(
    bool Enabled, int IntervalHours, int RetryMinutes, int InitialDelayMinutes,
    int RetentionDays, bool CleanupEnabled, string Source);

/// <summary>
/// Persists the panel override in the existing instance-settings store. The
/// database snapshot and key backup therefore include it without a new schema.
/// Publish only after the caller commits its audit and retention changes.
/// </summary>
public sealed class BackupPolicyStore(
    IOptions<AutomaticBackupOptions> defaults,
    IDataProtectionProvider protection)
{
    private const string PolicyName = "backups.policy";
    private readonly IDataProtector _protector = protection.CreateProtector("Stellarr.BackupPolicy.v1");
    private AutomaticBackupOptions? _override;

    public AutomaticBackupOptions Current => Volatile.Read(ref _override) ?? defaults.Value;
    public string Source => Volatile.Read(ref _override) is null ? "environment" : "panel";

    public async Task LoadAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var row = await db.InstanceSecrets.AsNoTracking().SingleOrDefaultAsync(x => x.Name == PolicyName, cancellationToken);
        if (row is not null)
        {
            Publish(JsonSerializer.Deserialize<AutomaticBackupOptions>(_protector.Unprotect(row.ProtectedValue))
                ?? throw new InvalidDataException("The backup policy is unreadable."));
        }
    }

    public async Task StageAsync(AppDbContext db, AutomaticBackupOptions policy, CancellationToken cancellationToken)
    {
        var row = await db.InstanceSecrets.SingleOrDefaultAsync(x => x.Name == PolicyName, cancellationToken);
        var encrypted = _protector.Protect(JsonSerializer.Serialize(policy));
        if (row is null)
            db.InstanceSecrets.Add(new InstanceSecret { Name = PolicyName, ProtectedValue = encrypted, UpdatedAt = DateTime.UtcNow });
        else
        {
            row.ProtectedValue = encrypted;
            row.UpdatedAt = DateTime.UtcNow;
        }
    }

    public void Publish(AutomaticBackupOptions policy) => Volatile.Write(ref _override, policy);

    public async Task StageResetAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var row = await db.InstanceSecrets.SingleOrDefaultAsync(x => x.Name == PolicyName, cancellationToken);
        if (row is not null) db.InstanceSecrets.Remove(row);
    }

    public void Reset() => Volatile.Write(ref _override, null);

    public static AutomaticBackupOptions FromRequest(BackupPolicyRequest request) => new()
    {
        Enabled = request.Enabled,
        IntervalHours = request.IntervalHours,
        RetryMinutes = request.RetryMinutes,
        InitialDelayMinutes = request.InitialDelayMinutes,
    };
}
