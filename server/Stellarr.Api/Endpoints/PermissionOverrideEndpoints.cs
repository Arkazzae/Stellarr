using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// What a role may do beyond, or short of, its own permissions inside one
/// channel or one section. Who may set it is decided by ManageRoles and not by
/// ManageChannels: it edits what a role grants, as the roles editor does.
/// </summary>
public static class PermissionOverrideEndpoints
{
    public static IEndpointRouteBuilder MapPermissionOverrideEndpoints(this IEndpointRouteBuilder endpoints)
    {
        MapTarget(endpoints, "channels", PermissionTargetType.Channel);
        MapTarget(endpoints, "sections", PermissionTargetType.Section);
        return endpoints;
    }

    private static void MapTarget(IEndpointRouteBuilder endpoints, string collection, PermissionTargetType targetType)
    {
        var overrides = endpoints.MapGroup($"/api/admin/{collection}/{{targetId:guid}}/permissions")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        overrides.MapGet("", (
            Guid targetId, HttpContext http, AppDbContext db, CancellationToken cancellationToken) =>
            ListAsync(targetType, targetId, http, db, cancellationToken));
        overrides.MapPut("/{roleId:guid}", (
            Guid targetId, Guid roleId, SetPermissionOverrideRequest request,
            HttpContext http, AppDbContext db, Messages messages, CancellationToken cancellationToken) =>
            SetAsync(targetType, targetId, roleId, request, http, db, messages, cancellationToken));
        overrides.MapDelete("/{roleId:guid}", (
            Guid targetId, Guid roleId, HttpContext http, AppDbContext db, CancellationToken cancellationToken) =>
            ClearAsync(targetType, targetId, roleId, http, db, cancellationToken));
    }

    private static async Task<IResult> ListAsync(
        PermissionTargetType targetType,
        Guid targetId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (await RefuseAsync(targetType, targetId, http, db, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        var overrides = await db.PermissionOverrides.AsNoTracking()
            .Where(x => x.TargetType == targetType && x.TargetId == targetId)
            .ToListAsync(cancellationToken);
        return Results.Ok(overrides.Select(x => x.ToDto()).ToArray());
    }

    private static async Task<IResult> SetAsync(
        PermissionTargetType targetType,
        Guid targetId,
        Guid roleId,
        SetPermissionOverrideRequest request,
        HttpContext http,
        AppDbContext db,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (await RefuseAsync(targetType, targetId, http, db, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        var serverId = http.RequireActiveServerId();
        if (!await db.ServerRoles.AnyAsync(x => x.Id == roleId && x.ServerId == serverId, cancellationToken))
        {
            return Results.NotFound();
        }

        if (!ServerAccess.TryParse(request.Allow, out var allow) || !ServerAccess.TryParse(request.Deny, out var deny))
        {
            return Invalid(messages.Get(MessageKey.PermissionUnknown));
        }

        if ((allow & deny) != ServerPrivileges.None)
        {
            return Invalid(messages.Get(MessageKey.PermissionAllowedAndDenied));
        }

        var current = await db.PermissionOverrides.FirstOrDefaultAsync(
            x => x.TargetType == targetType && x.TargetId == targetId && x.RoleId == roleId, cancellationToken);
        if (allow == ServerPrivileges.None && deny == ServerPrivileges.None)
        {
            if (current is not null)
            {
                db.PermissionOverrides.Remove(current);
                await db.SaveChangesAsync(cancellationToken);
            }

            return Results.Ok(new PermissionOverrideDto(roleId.ToString(), [], []));
        }

        if (current is null)
        {
            current = new PermissionOverride
            {
                Id = Guid.NewGuid(),
                ServerId = serverId,
                TargetType = targetType,
                TargetId = targetId,
                RoleId = roleId,
            };
            db.PermissionOverrides.Add(current);
        }

        current.AllowMask = allow;
        current.DenyMask = deny;
        return await db.TrySaveChangesAsync(cancellationToken) ? Results.Ok(current.ToDto()) : Results.Conflict();
    }

    private static async Task<IResult> ClearAsync(
        PermissionTargetType targetType,
        Guid targetId,
        Guid roleId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (await RefuseAsync(targetType, targetId, http, db, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        await db.PermissionOverrides
            .Where(x => x.TargetType == targetType && x.TargetId == targetId && x.RoleId == roleId)
            .ExecuteDeleteAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// The answer for a request that may not go on: 404 for a channel or section
    /// that is not on the server, which is looked for first, then 403 for a
    /// caller who may not manage roles. Null when it may.
    /// </summary>
    private static async Task<IResult?> RefuseAsync(
        PermissionTargetType targetType,
        Guid targetId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var exists = targetType == PermissionTargetType.Channel
            ? await db.Channels.AnyAsync(x => x.Id == targetId && x.ServerId == serverId, cancellationToken)
            : await db.Sections.AnyAsync(x => x.Id == targetId && x.ServerId == serverId, cancellationToken);
        if (!exists)
        {
            return Results.NotFound();
        }

        return await ServerAccess.HasAsync(
            db, http.User.RequireUserId(), serverId, ServerPrivileges.ManageRoles, cancellationToken)
            ? null
            : Results.Forbid();
    }

    private static IResult Invalid(string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["permissions"] = [message] });
}
