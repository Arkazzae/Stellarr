using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Cli;

internal static class SessionCommands
{
    private const int MaxListedSessions = 500;
    private const string RealtimeWarning =
        "Active WebSocket connections are not disconnected immediately; their cookie is rejected on the next request. Realtime teardown is deferred to a later release.";

    internal static async Task<CliResult> ListAsync(
        CliRuntime runtime,
        string? idOrUsername,
        CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        Guid? userId = null;
        if (idOrUsername is { } who)
        {
            userId = (await CommandSupport.ResolveUserAsync(db, who, cancellationToken)).Id;
        }

        var now = DateTime.UtcNow;
        var query = db.UserSessions.AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.RevokedAt == null && x.ExpiresAt > now);
        if (userId is { } selectedUser)
        {
            query = query.Where(x => x.UserId == selectedUser);
        }

        var total = await query.CountAsync(cancellationToken);
        var sessions = await query
            .OrderByDescending(x => x.LastSeenAt)
            .Take(MaxListedSessions)
            .ToArrayAsync(cancellationToken);
        var items = sessions.Select(Describe).ToArray();
        var lines = items.Select(item =>
            $"{item.Id}  {item.Username} ({item.UserDisplayName})  {item.Device}  " +
            $"last seen {item.LastSeenAt:O}  expires {item.ExpiresAt:O}  from {item.IpAddress}").ToList();
        if (total > sessions.Length)
        {
            lines.Add($"Showing the first {sessions.Length} of {total} active sessions.");
        }

        return new CliResult(
            "sessions.list",
            new { total, shown = sessions.Length, sessions = items },
            lines);
    }

    internal static async Task<CliResult> RevokeAsync(
        CliRuntime runtime,
        string id,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(id.Trim(), out var sessionId))
        {
            throw new CliException("invalid_session_id", $"'{id}' is not a session id.", CliExit.Usage);
        }

        await using var database = await runtime.OpenDatabaseAsync(mutation: true, cancellationToken);
        var db = database.Context;
        var session = await db.UserSessions.Include(x => x.User)
            .SingleOrDefaultAsync(x => x.Id == sessionId && x.RevokedAt == null, cancellationToken);
        if (session is null)
        {
            throw CommandSupport.SessionNotFound(id);
        }

        runtime.Confirm(
            $"Will revoke session {session.Id} of {session.User.DisplayName} ({session.User.Username}) on '{session.Device}'.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        session.RevokedAt = DateTime.UtcNow;
        db.OperatorAuditEntries.Add(CliDatabase.Audit("sessions.revoke", session.Id.ToString()));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new CliResult(
            "sessions.revoke",
            new
            {
                sessionId = session.Id.ToString(),
                session.UserId,
                username = session.User.Username,
                revoked = true,
                realtimeDisconnectDeferred = true,
            },
            [
                $"Revoked session {session.Id} of {session.User.DisplayName} ({session.User.Username}).",
                RealtimeWarning,
                "Audit: local-cli sessions.revoke " + session.Id,
            ],
            Warnings: [RealtimeWarning]);
    }

    internal static async Task<CliResult> RevokeAllAsync(
        CliRuntime runtime,
        string idOrUsername,
        CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: true, cancellationToken);
        var db = database.Context;
        var user = await CommandSupport.ResolveUserAsync(db, idOrUsername, cancellationToken);
        var now = DateTime.UtcNow;
        var active = await db.UserSessions.AsNoTracking()
            .Where(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now)
            .Select(x => x.Id)
            .ToArrayAsync(cancellationToken);
        var handoffs = await db.DesktopBrowserLogins.AsNoTracking()
            .CountAsync(
                x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null,
                cancellationToken);
        if (active.Length == 0 && handoffs == 0)
        {
            return new CliResult(
                "sessions.revoke-all",
                new
                {
                    userId = user.Id.ToString(),
                    username = user.Username,
                    sessionsRevoked = 0,
                    handoffsInvalidated = 0,
                    realtimeDisconnectDeferred = true,
                },
                [$"No active sessions or approved pending handoffs for {user.DisplayName} ({user.Username})."]);
        }

        runtime.Confirm(
            $"Will revoke {active.Length} active session(s) of {user.DisplayName} ({user.Username}) " +
            $"and invalidate {handoffs} approved desktop browser handoff(s).");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var revoked = await db.UserSessions
            .Where(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RevokedAt, now), cancellationToken);
        var invalidated = await db.DesktopBrowserLogins
            .Where(x => x.UserId == user.Id && x.ApprovedAt != null && x.RedeemedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.RedeemedAt, now), cancellationToken);
        db.OperatorAuditEntries.Add(CliDatabase.Audit("sessions.revoke-all", user.Id.ToString()));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new CliResult(
            "sessions.revoke-all",
            new
            {
                userId = user.Id.ToString(),
                username = user.Username,
                sessionsRevoked = revoked,
                handoffsInvalidated = invalidated,
                realtimeDisconnectDeferred = true,
            },
            [
                $"Revoked {revoked} active session(s) of {user.DisplayName} ({user.Username}).",
                $"Invalidated {invalidated} approved desktop browser handoff(s) not yet redeemed.",
                RealtimeWarning,
                "Audit: local-cli sessions.revoke-all " + user.Id,
            ],
            Warnings: [RealtimeWarning]);
    }

    private static SessionItem Describe(UserSession session) => new(
        session.Id.ToString(),
        session.UserId.ToString(),
        session.User.Username,
        session.User.DisplayName,
        session.Device,
        session.IpAddress,
        session.CreatedAt,
        session.LastSeenAt,
        session.ExpiresAt);
}

internal sealed record SessionItem(
    string Id,
    string UserId,
    string Username,
    string UserDisplayName,
    string Device,
    string IpAddress,
    DateTime CreatedAt,
    DateTime LastSeenAt,
    DateTime ExpiresAt);
