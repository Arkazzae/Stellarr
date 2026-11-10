using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The collapsible groups of the channel rail. A section is a label over the
/// server-wide channel order; it owns no order of its channels.
/// </summary>
public static class SectionEndpoints
{
    private const int MaxNameLength = 60;

    public static IEndpointRouteBuilder MapSectionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var sections = endpoints.MapGroup("/api/admin/sections")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        sections.MapPost("", CreateAsync);
        sections.MapPut("/order", ReorderAsync);
        sections.MapPatch("/{sectionId:guid}", RenameAsync);
        sections.MapDelete("/{sectionId:guid}", DeleteAsync);

        endpoints.MapGroup("/api/admin/channels")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>()
            .MapPatch("/{channelId:guid}/section", AssignChannelAsync);
        return endpoints;
    }

    private static async Task<IResult> CreateAsync(
        CreateSectionRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        if (!await ServerAccess.HasAsync(
                db, http.User.RequireUserId(), serverId, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim() ?? "";
        if (!IsValidName(name))
        {
            return InvalidName();
        }

        var lastPosition = await db.Sections.Where(x => x.ServerId == serverId)
            .MaxAsync(x => (int?)x.Position, cancellationToken);
        var section = new Section
        {
            Id = Guid.NewGuid(),
            ServerId = serverId,
            Name = name,
            Position = (lastPosition ?? -1) + 1,
        };
        db.Sections.Add(section);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Created($"/api/admin/sections/{section.Id}", section.ToDto());
    }

    private static async Task<IResult> RenameAsync(
        Guid sectionId,
        UpdateSectionRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var section = await db.Sections.FirstOrDefaultAsync(
            x => x.Id == sectionId && x.ServerId == serverId, cancellationToken);
        if (section is null)
        {
            return Results.NotFound();
        }

        if (!await ServerAccess.HasForSectionAsync(
                db, http.User.RequireUserId(), serverId, section.Id, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim();
        if (name is not null && !IsValidName(name))
        {
            return InvalidName();
        }

        section.Name = name ?? section.Name;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(section.ToDto());
    }

    private static async Task<IResult> ReorderAsync(
        ReorderSectionsRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        if (!await ServerAccess.HasAsync(
                db, http.User.RequireUserId(), serverId, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        var sections = await db.Sections.Where(x => x.ServerId == serverId).ToListAsync(cancellationToken);
        var order = request.SectionIds.Select((id, position) => (id, position)).ToList();
        if (order.Select(x => x.id).Distinct().Count() != order.Count ||
            !order.Select(x => x.id).ToHashSet().SetEquals(sections.Select(x => x.Id)))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["sectionIds"] = ["Lista musi zawierać każdą sekcję dokładnie raz."],
            });
        }

        var positions = order.ToDictionary(x => x.id, x => x.position);
        foreach (var section in sections)
        {
            section.Position = positions[section.Id];
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteAsync(
        Guid sectionId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var section = await db.Sections.AsNoTracking().FirstOrDefaultAsync(
            x => x.Id == sectionId && x.ServerId == serverId, cancellationToken);
        if (section is null)
        {
            return Results.NotFound();
        }

        if (!await ServerAccess.HasForSectionAsync(
                db, http.User.RequireUserId(), serverId, section.Id, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        // Channels are not tied to a section by a foreign key, so the emptiness
        // check and the delete are one statement: a channel moved in meanwhile
        // can not be left pointing at a section that is gone.
        var deleted = await db.Sections
            .Where(x => x.Id == section.Id && !db.Channels.Any(channel => channel.SectionId == x.Id))
            .ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? Results.Conflict() : Results.NoContent();
    }

    private static async Task<IResult> AssignChannelAsync(
        Guid channelId,
        AssignChannelSectionRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var userId = http.User.RequireUserId();
        var channel = await db.Channels.FirstOrDefaultAsync(
            x => x.Id == channelId && x.ServerId == serverId, cancellationToken);
        if (channel is null)
        {
            return Results.NotFound();
        }

        if (!await ServerAccess.HasAsync(
                db, userId, serverId, channel.Id, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        // Moving a channel in needs the right to manage the section it lands in
        // as well as the channel it leaves.
        if (request.SectionId is { } targetId)
        {
            if (!await db.Sections.AnyAsync(x => x.Id == targetId && x.ServerId == serverId, cancellationToken))
            {
                return Results.NotFound();
            }

            if (!await ServerAccess.HasForSectionAsync(
                    db, userId, serverId, targetId, ServerPrivileges.ManageChannels, cancellationToken))
            {
                return Results.Forbid();
            }
        }

        channel.SectionId = request.SectionId;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static bool IsValidName(string name) => name.Length is >= 1 and <= MaxNameLength;

    private static IResult InvalidName() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["name"] = ["Nazwa sekcji jest nieprawidłowa."],
        });
}
