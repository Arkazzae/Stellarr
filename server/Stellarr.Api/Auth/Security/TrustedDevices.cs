using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Auth.Security;

public static class TrustedDevices
{
    public static async Task<TrustedDevice?> FindAsync(
        AppDbContext db,
        Guid userId,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var token = SecurityCookies.ReadTrustedDevice(context);
        if (string.IsNullOrWhiteSpace(token) || token.Length > 512)
        {
            return null;
        }

        var hash = SecurityTokens.Hash(token);
        var now = DateTime.UtcNow;
        return await db.TrustedDevices.AsNoTracking().FirstOrDefaultAsync(
            x => x.UserId == userId &&
                x.TokenHash == hash &&
                x.RevokedAt == null &&
                x.ExpiresAt > now,
            cancellationToken);
    }

    public static async Task<TrustedDevice> IssueAsync(
        AppDbContext db,
        HttpContext context,
        Guid userId,
        SecurityPolicy policy,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var token = SecurityTokens.Random(32);
        var agent = context.Request.Headers.UserAgent.ToString().Trim();
        var device = new TrustedDevice
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TokenHash = SecurityTokens.Hash(token),
            Name = messages.Get(MessageKey.UnknownDevice),
            Device = agent.Length == 0 ? messages.Get(MessageKey.UnknownDevice) : agent[..Math.Min(agent.Length, 300)],
            IpAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            CreatedAt = now,
            ExpiresAt = now + policy.TrustedDeviceLifetime,
            LastUsedAt = now,
        };
        db.TrustedDevices.Add(device);
        SecurityCookies.SetTrustedDevice(context, token, device.ExpiresAt);
        return device;
    }

    public static async Task MarkUsedAsync(
        AppDbContext db,
        Guid deviceId,
        DateTime now,
        CancellationToken cancellationToken) =>
        await db.TrustedDevices
            .Where(x => x.Id == deviceId && x.RevokedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.LastUsedAt, now), cancellationToken);

    public static async Task<int> RevokeAllAsync(
        AppDbContext db,
        Guid userId,
        DateTime revokedAt,
        CancellationToken cancellationToken) =>
        await db.TrustedDevices
            .Where(x => x.UserId == userId && x.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, revokedAt), cancellationToken);
}
