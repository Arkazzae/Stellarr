using System.Net.Mail;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

// Accounts and roles of the instance server.
public static partial class CockpitEndpoints
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

        return Results.Ok(new CockpitUsersDto(
            members.Select(member => new CockpitUserDto(
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
            roles.Select(role => role.ToCockpitDto(memberCounts.GetValueOrDefault(role.Id))).ToArray(),
            SessionRegistryAvailable: true));
    }

    private static async Task<IResult> CreateUserAsync(
        CreateCockpitUserRequest request,
        HttpContext http,
        AppDbContext db,
        PasswordService passwords,
        Messages messages,
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
                ["user"] = [messages.Get(MessageKey.CockpitUserInvalid)],
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
                ["roleId"] = [messages.Get(MessageKey.CockpitRoleMustNotBeOwner)],
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
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditAccountCreated, ("name", displayName)),
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Created($"/api/cockpit/users/{id}", new { id = id.ToString() });
    }

    private static async Task<IResult> SetUserRoleAsync(
        Guid userId,
        SetCockpitUserRoleRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
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
            db,
            server.Id,
            actorId,
            messages.Get(MessageKey.AuditRoleChanged, ("name", member.User.DisplayName), ("role", role.Name)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await RoleEndpoints.NotifyAsync(hub, server.Id, [userId], role.Permissions, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> SetUserStatusAsync(
        Guid userId,
        SetCockpitUserStatusRequest request,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var actorId = http.User.RequireUserId();
        if (userId == actorId)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: messages.Get(MessageKey.CockpitCannotDisableSelf));
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
                title: messages.Get(MessageKey.CockpitCannotDisableOwner));
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
            messages.Get(
                request.Disabled ? MessageKey.AuditAccountDisabled : MessageKey.AuditAccountEnabled,
                ("name", member.User.DisplayName)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> CreateRoleAsync(
        CreateRoleRequest request,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        if (RoleEndpoints.Validate(request.Name, request.Color, request.Permissions) is not { } draft)
        {
            return RoleEndpoints.InvalidRole(messages);
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
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditRoleCreated, ("name", role.Name)),
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Created($"/api/cockpit/roles/{role.Id}", role.ToCockpitDto(memberCount: 0));
    }

    private static async Task<IResult> UpdateRoleAsync(
        Guid roleId,
        UpdateRoleRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
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
            return RoleEndpoints.InvalidRole(messages);
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
            db,
            server.Id,
            http.User.RequireUserId(),
            messages.Get(MessageKey.AuditRoleUpdated, ("name", role.Name)),
            cancellationToken);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        var holders = await db.ServerMembers.AsNoTracking()
            .Where(x => x.RoleId == role.Id)
            .Select(x => x.UserId)
            .ToArrayAsync(cancellationToken);
        await RoleEndpoints.NotifyAsync(hub, server.Id, holders, role.Permissions, cancellationToken);
        return Results.Ok(role.ToCockpitDto(holders.Length));
    }

    private static bool IsValidNewAccount(string username, string displayName, string? email, string? password) =>
        username.Length is >= 2 and <= 32 &&
        username.All(character => char.IsLetterOrDigit(character) || "_.-".Contains(character)) &&
        displayName.Length is >= 1 and <= 64 &&
        !PasswordPolicy.IsTooShort(password) &&
        !PasswordPolicy.IsTooLong(password) &&
        (email is null || MailAddress.TryCreate(email, out _));
}
