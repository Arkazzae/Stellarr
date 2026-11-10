using System.Net.Mail;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

// Accounts and roles of the instance server.
public static partial class OpsEndpoints
{
    private static async Task<IResult> GetUsersAsync(
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireInstanceServer().Id;
        var members = await db.ServerMembers.AsNoTracking()
            .Include(x => x.User)
            .Include(x => x.Role)
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.User.DisplayName)
            .ToArrayAsync(cancellationToken);
        var roles = await db.ServerRoles.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.Position)
            .ToArrayAsync(cancellationToken);
        var memberCounts = members.GroupBy(x => x.RoleId)
            .ToDictionary(group => group.Key, group => group.Count());

        return Results.Ok(new OpsUsersDto(
            members.Select(member => new OpsUserDto(
                member.User.Id.ToString(),
                member.User.Username,
                member.User.DisplayName,
                member.User.Email,
                member.User.AvatarColor,
                member.User.AvatarUrl,
                presence.PublicPresenceOf(member.UserId),
                presence.ConnectionIds(member.UserId).Count,
                member.RoleId.ToString(),
                member.Role.Name,
                member.User.IsDisabled,
                member.JoinedAt,
                member.User.CreatedAt)).ToArray(),
            roles.Select(role => role.ToOpsDto(memberCounts.GetValueOrDefault(role.Id))).ToArray(),
            SessionRegistryAvailable: true));
    }

    private static async Task<IResult> CreateUserAsync(
        CreateOpsUserRequest request,
        HttpContext http,
        AppDbContext db,
        PasswordService passwords,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var username = request.Username?.Trim() ?? "";
        var displayName = request.DisplayName?.Trim() ?? "";
        var email = request.Email?.Trim();
        if (string.IsNullOrEmpty(email))
        {
            email = null;
        }

        if (!IsValidNewAccount(username, displayName, email, request.Password))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["user"] = ["Sprawdź login, nazwę, e-mail i hasło (minimum 8 znaków)."],
            });
        }

        var normalizedUsername = username.ToUpperInvariant();
        var normalizedEmail = email?.ToUpperInvariant();
        if (await db.Users.AnyAsync(
                x => x.NormalizedUsername == normalizedUsername ||
                    (normalizedEmail != null && x.NormalizedEmail == normalizedEmail),
                cancellationToken))
        {
            return Results.Conflict();
        }

        var role = await db.ServerRoles.AsNoTracking().FirstOrDefaultAsync(
            x => x.Id == request.RoleId && x.ServerId == server.Id && !x.IsOwner,
            cancellationToken);
        if (role is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["roleId"] = ["Wybierz rolę inną niż właściciel."],
            });
        }

        var now = DateTime.UtcNow;
        var id = Guid.NewGuid();
        db.Users.Add(new User
        {
            Id = id,
            Username = username,
            NormalizedUsername = normalizedUsername,
            DisplayName = displayName,
            Email = email,
            NormalizedEmail = normalizedEmail,
            PasswordHash = passwords.Hash(request.Password!),
            AvatarColor = $"oklch(0.58 0.14 {(uint)id.GetHashCode() % 360})",
            CreatedAt = now,
        });
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = server.Id,
            UserId = id,
            RoleId = role.Id,
            JoinedAt = now,
        });
        await StageAuditAsync(
            db, server.Id, http.User.RequireUserId(), $"utworzył(a) konto {displayName}", cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Created($"/api/ops/users/{id}", new { id = id.ToString() });
    }

    private static async Task<IResult> SetUserRoleAsync(
        Guid userId,
        SetOpsUserRoleRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var actorId = http.User.RequireUserId();
        if (userId == actorId)
        {
            return Results.Conflict();
        }

        var member = await db.ServerMembers.Include(x => x.User).Include(x => x.Role)
            .FirstOrDefaultAsync(x => x.ServerId == server.Id && x.UserId == userId, cancellationToken);
        var role = await db.ServerRoles.AsNoTracking().FirstOrDefaultAsync(
            x => x.ServerId == server.Id && x.Id == request.RoleId && !x.IsOwner,
            cancellationToken);
        if (member is null || role is null)
        {
            return Results.NotFound();
        }

        if (member.Role.IsOwner)
        {
            return Results.Conflict();
        }

        member.RoleId = role.Id;
        await StageAuditAsync(
            db, server.Id, actorId, $"zmienił(a) rolę {member.User.DisplayName} na {role.Name}", cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await RoleEndpoints.NotifyAsync(hub, server.Id, [userId], role.Permissions, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> SetUserStatusAsync(
        Guid userId,
        SetOpsUserStatusRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var actorId = http.User.RequireUserId();
        if (userId == actorId)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Nie możesz wyłączyć własnego konta.");
        }

        var member = await db.ServerMembers.Include(x => x.User).Include(x => x.Role)
            .SingleOrDefaultAsync(x => x.ServerId == server.Id && x.UserId == userId, cancellationToken);
        if (member is null)
        {
            return Results.NotFound();
        }

        if (member.Role.IsOwner)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Konta właściciela nie można wyłączyć.");
        }

        if (member.User.IsDisabled == request.Disabled)
        {
            return Results.NoContent();
        }

        // A new session version turns every cookie of the account away, and the
        // revoked rows keep the session list honest about it.
        member.User.IsDisabled = request.Disabled;
        member.User.SessionVersion++;
        if (request.Disabled)
        {
            var revokedAt = DateTime.UtcNow;
            var sessions = await db.UserSessions
                .Where(x => x.UserId == userId && x.RevokedAt == null)
                .ToListAsync(cancellationToken);
            foreach (var session in sessions)
            {
                session.RevokedAt = revokedAt;
            }
        }

        await StageAuditAsync(
            db,
            server.Id,
            actorId,
            $"{(request.Disabled ? "wyłączył(a)" : "włączył(a)")} konto {member.User.DisplayName}",
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> CreateRoleAsync(
        CreateRoleRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (RoleEndpoints.Validate(request.Name, request.Color, request.Permissions) is not { } draft)
        {
            return RoleEndpoints.InvalidRole();
        }

        if (await db.ServerRoles.AnyAsync(
                x => x.ServerId == server.Id && x.Name == draft.Name, cancellationToken))
        {
            return Results.Conflict();
        }

        var lastPosition = await db.ServerRoles.Where(x => x.ServerId == server.Id)
            .MaxAsync(x => (int?)x.Position, cancellationToken);
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = draft.Name,
            Color = draft.Color,
            Permissions = draft.Permissions,
            Position = (lastPosition ?? -1) + 1,
        };
        db.ServerRoles.Add(role);
        await StageAuditAsync(
            db, server.Id, http.User.RequireUserId(), $"utworzył(a) rolę {role.Name}", cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Created($"/api/ops/roles/{role.Id}", role.ToOpsDto(memberCount: 0));
    }

    private static async Task<IResult> UpdateRoleAsync(
        Guid roleId,
        UpdateRoleRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var role = await db.ServerRoles.FirstOrDefaultAsync(
            x => x.ServerId == server.Id && x.Id == roleId, cancellationToken);
        if (role is null)
        {
            return Results.NotFound();
        }

        if (role.IsOwner)
        {
            return Results.Conflict();
        }

        var draft = RoleEndpoints.Validate(
            request.Name ?? role.Name,
            request.Color ?? role.Color,
            request.Permissions ?? ServerAccess.ToNames(role.Permissions));
        if (draft is null)
        {
            return RoleEndpoints.InvalidRole();
        }

        if (await db.ServerRoles.AnyAsync(
                x => x.ServerId == server.Id && x.Id != roleId && x.Name == draft.Name, cancellationToken))
        {
            return Results.Conflict();
        }

        role.Name = draft.Name;
        role.Color = draft.Color;
        role.Permissions = draft.Permissions;
        await StageAuditAsync(
            db, server.Id, http.User.RequireUserId(), $"zaktualizował(a) rolę {role.Name}", cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        var holders = await db.ServerMembers.AsNoTracking()
            .Where(x => x.RoleId == role.Id)
            .Select(x => x.UserId)
            .ToArrayAsync(cancellationToken);
        await RoleEndpoints.NotifyAsync(hub, server.Id, holders, role.Permissions, cancellationToken);
        return Results.Ok(role.ToOpsDto(holders.Length));
    }

    private static bool IsValidNewAccount(string username, string displayName, string? email, string? password) =>
        username.Length is >= 2 and <= 32 &&
        username.All(character => char.IsLetterOrDigit(character) || "_.-".Contains(character)) &&
        displayName.Length is >= 1 and <= 64 &&
        PasswordPolicy.Violation(password) is null &&
        (email is null || MailAddress.TryCreate(email, out _));
}
