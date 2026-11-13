using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Integrations.Cloudflare;

/// <summary>Non-secret connection settings saved in Cockpit; credentials use InstanceSecrets.</summary>
public sealed record CloudflareR2Request(
    bool Enabled, string Endpoint, string Region, string Bucket, string Prefix);

public sealed record CloudflareR2Dto(
    bool Enabled, string Endpoint, string Region, string Bucket, string Prefix, string Source);

/// <summary>
/// Persists the panel override in the existing instance-settings store, next
/// to the other instance secrets. The database snapshot and key backup
/// therefore include it without a new schema. Publish only after the caller
/// commits its audit change.
/// </summary>
public sealed class CloudflareR2PolicyStore(
    IOptions<CloudflareR2Options> defaults,
    IDataProtectionProvider protection,
    IServiceScopeFactory scopes)
{
    private const string PolicyName = "cloudflare.r2.policy";
    private readonly IDataProtector _protector = protection.CreateProtector("Stellarr.CloudflareR2.v1");
    private CloudflareR2Options? _override;

    public CloudflareR2Options Current => Volatile.Read(ref _override) ?? defaults.Value;
    public string Source => Volatile.Read(ref _override) is null ? "environment" : "panel";

    public async Task LoadAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var row = await db.InstanceSecrets.AsNoTracking().SingleOrDefaultAsync(x => x.Name == PolicyName, cancellationToken);
        if (row is not null)
        {
            Publish(JsonSerializer.Deserialize<CloudflareR2Options>(_protector.Unprotect(row.ProtectedValue))
                ?? throw new InvalidDataException("The Cloudflare R2 settings are unreadable."));
        }
    }

    public async Task<CloudflareR2Options> ResolveAsync(CancellationToken cancellationToken)
    {
        var policy = Current;
        await using var scope = scopes.CreateAsyncScope();
        var resolved = await scope.ServiceProvider.GetRequiredService<InstanceSecrets>().ReadAsync(cancellationToken);
        return Build(policy, resolved[SecretNames.CloudflareR2AccessKey].Value,
            resolved[SecretNames.CloudflareR2SecretKey].Value);
    }

    public async Task StageAsync(AppDbContext db, CloudflareR2Options policy, CancellationToken cancellationToken)
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

    public void Publish(CloudflareR2Options policy) => Volatile.Write(ref _override, policy);

    public async Task StageResetAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var row = await db.InstanceSecrets.SingleOrDefaultAsync(x => x.Name == PolicyName, cancellationToken);
        if (row is not null) db.InstanceSecrets.Remove(row);
    }

    public void Reset() => Volatile.Write(ref _override, null);

    public static CloudflareR2Options FromRequest(CloudflareR2Request request) => new()
    {
        Enabled = request.Enabled,
        Endpoint = request.Endpoint.Trim(),
        Region = request.Region.Trim(),
        Bucket = request.Bucket.Trim(),
        Prefix = request.Prefix.Trim(),
    };

    private static CloudflareR2Options Build(CloudflareR2Options policy, string accessKey, string secretKey) => new()
    {
        Enabled = policy.Enabled,
        Endpoint = policy.Endpoint,
        Region = policy.Region,
        Bucket = policy.Bucket,
        Prefix = policy.Prefix,
        AccessKey = accessKey,
        SecretKey = secretKey,
    };
}
