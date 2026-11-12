using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Cli;

internal static class UserCommands
{
    private const int MaxListedUsers = 200;

    internal static async Task<CliResult> ListAsync(CliRuntime runtime, CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken);
        var total = await db.Users.AsNoTracking().CountAsync(cancellationToken);
        var users = await db.Users.AsNoTracking()
            .OrderBy(x => x.DisplayName).ThenBy(x => x.Username)
            .Take(MaxListedUsers)
            .ToArrayAsync(cancellationToken);
        var memberships = await db.ServerMembers.AsNoTracking()
            .Include(x => x.Role)
            .Where(x => x.ServerId == server.Id && users.Select(user => user.Id).Contains(x.UserId))
            .ToDictionaryAsync(x => x.UserId, cancellationToken);

        var items = users.Select(user =>
        {
            memberships.TryGetValue(user.Id, out var member);
            return Describe(user, member);
        }).ToArray();
        var lines = items.Select(item =>
            $"{item.Id}  {item.Username}  {item.DisplayName}" +
            (item.Email is null ? "" : $"  <{item.Email}>") +
            (item.Disabled ? "  [disabled]" : "") +
            (item.RoleName is null ? "" : $"  role={item.RoleName}")).ToList();
        if (total > users.Length)
        {
            lines.Add($"Showing the first {users.Length} of {total} accounts.");
        }

        return new CliResult(
            "users.list",
            new { total, shown = users.Length, users = items },
            lines);
    }

    internal static async Task<CliResult> ShowAsync(
        CliRuntime runtime,
        string idOrUsername,
        CancellationToken cancellationToken)
    {
        await using var database = await runtime.OpenDatabaseAsync(mutation: false, cancellationToken);
        var db = database.Context;
        var user = await CommandSupport.ResolveUserAsync(db, idOrUsername, cancellationToken);
        var server = await CommandSupport.RequireInstanceServerAsync(db, cancellationToken);
        var member = await db.ServerMembers.AsNoTracking()
            .Include(x => x.Role)
            .SingleOrDefaultAsync(x => x.ServerId == server.Id && x.UserId == user.Id, cancellationToken);
        var now = DateTime.UtcNow;
        var activeSessions = await db.UserSessions.AsNoTracking()
            .CountAsync(x => x.UserId == user.Id && x.RevokedAt == null && x.ExpiresAt > now, cancellationToken);
        var item = Describe(user, member) with { ActiveSessions = activeSessions };
        var lines = new List<string>
        {
            $"Id: {item.Id}",
            $"Username: {item.Username}",
            $"Display name: {item.DisplayName}",
            $"Email: {item.Email ?? "(none)"}",
            $"Disabled: {(item.Disabled ? "yes" : "no")}",
            $"Created: {item.CreatedAt:O}",
            $"Role: {item.RoleName ?? "(not a member of the instance server)"}",
            $"Joined instance server: {(item.JoinedAt is { } joined ? joined.ToString("O") : "(not a member)")}",
            $"Active sessions: {item.ActiveSessions}",
        };
        return new CliResult("users.show", item, lines);
    }

    private static UserItem Describe(User user, ServerMember? member) => new(
        user.Id.ToString(),
        user.Username,
        user.DisplayName,
        user.Email,
        user.IsDisabled,
        user.CreatedAt,
        member?.Role.Name,
        member?.JoinedAt,
        0);
}

internal sealed record UserItem(
    string Id,
    string Username,
    string DisplayName,
    string? Email,
    bool Disabled,
    DateTime CreatedAt,
    string? RoleName,
    DateTime? JoinedAt,
    int ActiveSessions);
