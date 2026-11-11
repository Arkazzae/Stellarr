using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Localization;

namespace Stellarr.Api.Endpoints;

public static partial class CockpitEndpoints
{
    /// <summary>Every server of the instance, oldest first, the instance server among them.</summary>
    private static async Task<IResult> GetServersAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var instanceId = http.RequireInstanceServer().Id;
        var rows = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.Name,
                x.Description,
                x.IsPublic,
                x.CreatedAt,
                Owner = db.ServerMembers
                    .Where(member => member.ServerId == x.Id && member.Role.IsOwner)
                    .Select(member => new { member.UserId, member.User.Username, member.User.DisplayName })
                    .FirstOrDefault(),
                MemberCount = db.ServerMembers.Count(member => member.ServerId == x.Id),
                ChannelCount = db.Channels.Count(channel => channel.ServerId == x.Id),
            })
            .ToListAsync(cancellationToken);

        return Results.Ok(rows.Select(x => new CockpitServerDto(
            x.Id.ToString(),
            x.Name,
            x.Description,
            x.IsPublic,
            x.CreatedAt,
            x.Id == instanceId,
            x.Owner is null ? null : new CockpitServerPersonDto(x.Owner.UserId.ToString(), x.Owner.Username, x.Owner.DisplayName),
            x.MemberCount,
            x.ChannelCount)).ToArray());
    }

    /// <summary>The members of one server, the people its ownership can go to.</summary>
    private static async Task<IResult> GetServerMembersAsync(
        Guid serverId,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        if (!await db.Servers.AsNoTracking().AnyAsync(x => x.Id == serverId, cancellationToken))
        {
            return Results.NotFound();
        }

        var members = await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.User.DisplayName).ThenBy(x => x.User.Username)
            .Select(x => new { x.UserId, x.User.Username, x.User.DisplayName, x.Role.IsOwner })
            .ToListAsync(cancellationToken);

        return Results.Ok(members.Select(x => new CockpitServerMemberDto(
            x.UserId.ToString(),
            x.Username,
            x.DisplayName,
            x.IsOwner)).ToArray());
    }

    /// <summary>
    /// Hands a server to another of its members. The instance server is refused:
    /// its owner is the operator, and handing it on would lock them out of Cockpit.
    /// </summary>
    private static async Task<IResult> TransferServerAsync(
        Guid serverId,
        TransferCockpitServerRequest request,
        HttpContext http,
        AppDbContext db,
        ServerMutationGate gate,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var instanceId = http.RequireInstanceServer().Id;
        if (serverId == instanceId)
        {
            return InstanceServerProblem(messages);
        }

        await using var turn = await gate.EnterAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var name = await db.Servers.AsNoTracking()
            .Where(x => x.Id == serverId)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken);
        if (name is null)
        {
            return Results.NotFound();
        }

        var owner = await db.ServerMembers
            .FirstOrDefaultAsync(x => x.ServerId == serverId && x.Role.IsOwner, cancellationToken);
        var successor = await db.ServerMembers.Include(x => x.User)
            .FirstOrDefaultAsync(x => x.ServerId == serverId && x.UserId == request.UserId, cancellationToken);
        if (owner is null || successor is null || successor.UserId == owner.UserId)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["userId"] = [messages.Get(MessageKey.TransferTargetInvalid)],
            });
        }

        await ServerOwnership.HandOverAsync(db, serverId, owner, successor, cancellationToken);
        var operatorId = http.User.RequireUserId();
        await StageAuditAsync(db, serverId, operatorId, messages.Get(MessageKey.AuditOwnershipTransferred), cancellationToken);
        await StageAuditAsync(
            db,
            instanceId,
            operatorId,
            messages.Get(
                MessageKey.CockpitAuditServerTransferred,
                ("server", name),
                ("name", successor.User.DisplayName)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>Deletes a server other than the instance server, and notes it in the instance's audit log.</summary>
    private static async Task<IResult> DeleteServerAsync(
        Guid serverId,
        HttpContext http,
        AppDbContext db,
        ServerMutationGate gate,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var instanceId = http.RequireInstanceServer().Id;
        if (serverId == instanceId)
        {
            return InstanceServerProblem(messages);
        }

        await using var turn = await gate.EnterAsync(cancellationToken);
        var name = await db.Servers.AsNoTracking()
            .Where(x => x.Id == serverId)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken);
        if (name is null || !await ServerOwnership.DeleteAsync(db, serverId, cancellationToken))
        {
            return Results.NotFound();
        }

        await StageAuditAsync(
            db,
            instanceId,
            http.User.RequireUserId(),
            messages.Get(MessageKey.CockpitAuditServerDeleted, ("name", name)),
            cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static IResult InstanceServerProblem(Messages messages) => Results.Problem(
        statusCode: StatusCodes.Status409Conflict,
        title: messages.Get(MessageKey.CockpitServerIsInstance));
}
