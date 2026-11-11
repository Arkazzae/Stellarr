using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

// Signed-in devices of the instance server's members.
public static partial class CockpitEndpoints
{
    private const int MaxListedSessions = 500;

    private static async Task<IResult> GetSessionsAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        var currentId = http.User.FindSessionId();
        var now = DateTime.UtcNow;
        var sessions = await db.UserSessions.AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.RevokedAt == null && x.ExpiresAt > now &&
                db.ServerMembers.Any(member => member.ServerId == serverId && member.UserId == x.UserId))
            .OrderByDescending(x => x.LastSeenAt)
            .Take(MaxListedSessions)
            .ToArrayAsync(cancellationToken);

        return Results.Ok(sessions.Select(session =>
        {
            var client = DescribeClient(session.Device);
            return new CockpitSessionDto(
                session.Id.ToString(),
                session.UserId.ToString(),
                session.User.DisplayName,
                session.Device,
                client.Name,
                client.Version,
                client.Runtime,
                client.InstallType,
                session.IpAddress,
                session.CreatedAt,
                session.LastSeenAt,
                session.ExpiresAt,
                session.Id == currentId);
        }));
    }

    private static async Task<IResult> RevokeSessionAsync(
        Guid sessionId,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (http.User.FindSessionId() == sessionId)
        {
            return Results.Conflict();
        }

        var session = await db.UserSessions.Include(x => x.User).FirstOrDefaultAsync(
            x => x.Id == sessionId && x.RevokedAt == null &&
                db.ServerMembers.Any(member => member.ServerId == server.Id && member.UserId == x.UserId),
            cancellationToken);
        if (session is null)
        {
            return Results.NotFound();
        }

        session.RevokedAt = DateTime.UtcNow;
        await StageAuditAsync(
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditSessionRevoked, ("name", session.User.DisplayName)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }
}
