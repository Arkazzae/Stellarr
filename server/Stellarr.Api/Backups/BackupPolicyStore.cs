using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Backups;

/// <summary>Non-secret policy overridden in Cockpit; credentials use InstanceSecrets.</summary>
public sealed record BackupPolicyRequest(
    bool Enabled, int IntervalHours, int RetryMinutes, int InitialDelayMinutes,
    bool RemoteEnabled, string Endpoint, string Region, string Bucket, string Prefix,
    int RetentionDays);

public sealed record BackupPolicyDto(
    bool Enabled, int IntervalHours, int RetryMinutes, int InitialDelayMinutes,
    bool RemoteEnabled, string Endpoint, string Region, string Bucket, string Prefix,
    int RetentionDays, bool CleanupEnabled, string Source);

/// <summary>
/// Persists the panel override in the existing instance-settings store. The
/// database snapshot and key backup therefore include it without a new schema.
/// Publish only after the caller commits its audit and retention changes.
/// </summary>
public sealed class BackupPolicyStore(
    IOptions<AutomaticBackupOptions> defaults,
    IDataProtectionProvider protection,
    IServiceScopeFactory scopes)
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

    public async Task<AutomaticBackupOptions> ResolveAsync(CancellationToken cancellationToken)
    {
        var policy = Current;
        await using var scope = scopes.CreateAsyncScope();
        var resolved = await scope.ServiceProvider.GetRequiredService<InstanceSecrets>().ReadAsync(cancellationToken);
        return Build(policy, resolved[SecretNames.BackupAccessKey].Value, resolved[SecretNames.BackupSecretKey].Value);
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
        Enabled = request.Enabled, IntervalHours = request.IntervalHours,
        RetryMinutes = request.RetryMinutes, InitialDelayMinutes = request.InitialDelayMinutes,
        Destination = new BackupDestinationOptions
        {
            Enabled = request.RemoteEnabled, Endpoint = request.Endpoint.Trim(), Region = request.Region.Trim(),
            Bucket = request.Bucket.Trim(), Prefix = request.Prefix.Trim(),
        },
    };

    private static AutomaticBackupOptions Build(AutomaticBackupOptions policy, string accessKey, string secretKey) => new()
    {
        Enabled = policy.Enabled, IntervalHours = policy.IntervalHours,
        RetryMinutes = policy.RetryMinutes, InitialDelayMinutes = policy.InitialDelayMinutes,
        Destination = new BackupDestinationOptions
        {
            Enabled = policy.Destination.Enabled, Endpoint = policy.Destination.Endpoint,
            Region = policy.Destination.Region, Bucket = policy.Destination.Bucket, Prefix = policy.Destination.Prefix,
            AccessKey = accessKey, SecretKey = secretKey,
        },
    };
}
