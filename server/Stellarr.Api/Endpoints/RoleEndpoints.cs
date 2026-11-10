using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The roles of a server and who holds them. Nobody can hand out, or take
/// away, a power they do not have themselves.
/// </summary>
public static class RoleEndpoints
{
    private const int MaxNameLength = 64;
    private const int MaxColorLength = 48;

    internal sealed record RoleDraft(string Name, string Color, ServerPrivileges Permissions);

    public static IEndpointRouteBuilder MapRoleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints.MapGroup("/api/admin")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        admin.MapGet("/roles", ListRolesAsync);
        admin.MapPost("/roles", CreateRoleAsync);
        admin.MapPatch("/roles/{roleId:guid}", UpdateRoleAsync);
        admin.MapDelete("/roles/{roleId:guid}", DeleteRoleAsync);
        admin.MapGet("/members", ListMembersAsync);
        admin.MapPatch("/members/{userId:guid}/role", AssignRoleAsync);
        return endpoints;
    }

    private static async Task<IResult> ListRolesAsync(HttpContext http, AppDbContext db, CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var roles = await db.ServerRoles.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.Position)
            .Select(x => new { Role = x, Members = db.ServerMembers.Count(member => member.RoleId == x.Id) })
            .ToListAsync(cancellationToken);
        return Results.Ok(roles.Select(x => x.Role.ToDto(x.Members)));
    }

    private static async Task<IResult> ListMembersAsync(
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var viewerId = http.User.RequireUserId();
        var members = await db.ServerMembers.AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.User.DisplayName)
            .ToListAsync(cancellationToken);
        return Results.Ok(members.Select(x => new ServerMemberDto(
            x.User.ToDto(presence.PublicPresenceOf(x.UserId, viewerId)),
            x.RoleId.ToString(),
            x.JoinedAt)));
    }

    private static async Task<IResult> CreateRoleAsync(
        CreateRoleRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var held = await ServerAccess.GetAsync(db, http.User.RequireUserId(), serverId, cancellationToken);
        if (!held.HasFlag(ServerPrivileges.ManageRoles))
        {
            return Results.Forbid();
        }

        if (Validate(request.Name, request.Color, request.Permissions) is not { } draft)
        {
            return InvalidRole();
        }

        if (await db.ServerRoles.AnyAsync(x => x.ServerId == serverId && x.Name == draft.Name, cancellationToken))
        {
            return Results.Conflict();
        }

        if (ExceedsHeld(draft.Permissions, held))
        {
            return Results.Forbid();
        }

        var lastPosition = await db.ServerRoles.Where(x => x.ServerId == serverId)
            .MaxAsync(x => (int?)x.Position, cancellationToken);
        var role = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = serverId,
            Name = draft.Name,
            Color = draft.Color,
            Permissions = draft.Permissions,
            Position = (lastPosition ?? -1) + 1,
        };
        db.ServerRoles.Add(role);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Created($"/api/admin/roles/{role.Id}", role.ToDto(0));
    }

    private static async Task<IResult> UpdateRoleAsync(
        Guid roleId,
        UpdateRoleRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var held = await ServerAccess.GetAsync(db, http.User.RequireUserId(), serverId, cancellationToken);
        if (!held.HasFlag(ServerPrivileges.ManageRoles))
        {
            return Results.Forbid();
        }

        var role = await db.ServerRoles.FirstOrDefaultAsync(
            x => x.Id == roleId && x.ServerId == serverId, cancellationToken);
        if (role is null)
        {
            return Results.NotFound();
        }

        if (role.IsOwner)
        {
            return Results.Conflict();
        }

        var draft = Validate(
            request.Name ?? role.Name,
            request.Color ?? role.Color,
            request.Permissions ?? ServerAccess.ToNames(role.Permissions));
        if (draft is null)
        {
            return InvalidRole();
        }

        if (await db.ServerRoles.AnyAsync(
                x => x.ServerId == serverId && x.Id != role.Id && x.Name == draft.Name, cancellationToken))
        {
            return Results.Conflict();
        }

        if (ExceedsHeld(draft.Permissions, held))
        {
            return Results.Forbid();
        }

        role.Name = draft.Name;
        role.Color = draft.Color;
        role.Permissions = draft.Permissions;
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        var holders = db.ServerMembers.Where(x => x.RoleId == role.Id);
        await NotifyAsync(hub, serverId, await holders.Select(x => x.UserId).ToListAsync(cancellationToken),
            role.Permissions, cancellationToken);
        return Results.Ok(role.ToDto(await holders.CountAsync(cancellationToken)));
    }

    private static async Task<IResult> DeleteRoleAsync(
        Guid roleId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var held = await ServerAccess.GetAsync(db, http.User.RequireUserId(), serverId, cancellationToken);
        if (!held.HasFlag(ServerPrivileges.ManageRoles))
        {
            return Results.Forbid();
        }

        var role = await db.ServerRoles.AsNoTracking().FirstOrDefaultAsync(
            x => x.Id == roleId && x.ServerId == serverId, cancellationToken);
        if (role is null)
        {
            return Results.NotFound();
        }

        if (role.IsSystem)
        {
            return Results.Conflict();
        }

        if (ExceedsHeld(role.Permissions, held))
        {
            return Results.Forbid();
        }

        // Its members fall back to the plain member role rather than to nothing.
        var fallback = await db.ServerRoles.AsNoTracking().SingleAsync(
            x => x.ServerId == serverId && x.IsSystem && !x.IsOwner, cancellationToken);
        var holders = await db.ServerMembers.Where(x => x.RoleId == role.Id)
            .Select(x => x.UserId).ToListAsync(cancellationToken);
        await using (var transaction = await db.Database.BeginTransactionAsync(cancellationToken))
        {
            await db.ServerMembers.Where(x => x.RoleId == role.Id)
                .ExecuteUpdateAsync(x => x.SetProperty(member => member.RoleId, fallback.Id), cancellationToken);
            await db.ServerRoles.Where(x => x.Id == role.Id).ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        await NotifyAsync(hub, serverId, holders, fallback.Permissions, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> AssignRoleAsync(
        Guid userId,
        AssignRoleRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var actorId = http.User.RequireUserId();
        var held = await ServerAccess.GetAsync(db, actorId, serverId, cancellationToken);
        if (!held.HasFlag(ServerPrivileges.ManageMembers) || actorId == userId)
        {
            return Results.Forbid();
        }

        var member = await db.ServerMembers.Include(x => x.Role).FirstOrDefaultAsync(
            x => x.ServerId == serverId && x.UserId == userId, cancellationToken);
        var role = await db.ServerRoles.AsNoTracking().FirstOrDefaultAsync(
            x => x.ServerId == serverId && x.Id == request.RoleId, cancellationToken);
        if (member is null || role is null)
        {
            return Results.NotFound();
        }

        // The owner is neither demoted nor joined by anybody: handing over the
        // server is a transfer of its own.
        if (member.Role.IsOwner || role.IsOwner)
        {
            return Results.Conflict();
        }

        if (ExceedsHeld(role.Permissions, held))
        {
            return Results.Forbid();
        }

        member.RoleId = role.Id;
        await db.SaveChangesAsync(cancellationToken);
        await NotifyAsync(hub, serverId, [userId], role.Permissions, cancellationToken);
        return Results.NoContent();
    }

    private static bool ExceedsHeld(ServerPrivileges wanted, ServerPrivileges held) => (wanted & ~held) != 0;

    internal static RoleDraft? Validate(string? name, string? color, IEnumerable<string>? permissionNames)
    {
        var trimmedName = name?.Trim() ?? "";
        var trimmedColor = color?.Trim() ?? "";
        return trimmedName.Length is >= 1 and <= MaxNameLength &&
            trimmedColor.Length is >= 1 and <= MaxColorLength &&
            ServerAccess.TryParse(permissionNames, out var permissions)
            ? new RoleDraft(trimmedName, trimmedColor, permissions)
            : null;
    }

    internal static IResult InvalidRole() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["role"] = ["Nazwa, kolor lub lista uprawnień roli jest nieprawidłowa."],
        });

    internal static async Task NotifyAsync(
        IHubContext<AppHub> hub,
        Guid serverId,
        IEnumerable<Guid> userIds,
        ServerPrivileges permissions,
        CancellationToken cancellationToken)
    {
        var groups = userIds.Distinct().Select(AppHub.UserGroup).ToArray();
        if (groups.Length > 0)
        {
            await hub.Clients.Groups(groups).SendAsync(
                "PermissionsChanged",
                new PermissionsChangedDto(serverId.ToString(), ServerAccess.ToNames(permissions)),
                cancellationToken);
        }
    }
}
