using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Endpoints;

/// <summary>Creating, ordering, configuring and removing the channels of a server.</summary>
public static class ChannelEndpoints
{
    private const int MaxNameLength = 60;
    private const int MaxTopicLength = 1024;
    private const int MaxSlowModeSeconds = 6 * 60 * 60;
    private const int MaxHideAfterInactivityHours = 365 * 24;
    private const int MaxUserLimit = 99;

    private static readonly string[] AudioProfiles =
        ["economy", "balanced", "clarity", "premium", "studio"];

    public static IEndpointRouteBuilder MapChannelEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var channels = endpoints.MapGroup("/api/admin/channels")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();
        channels.MapPost("", CreateAsync);
        channels.MapPut("/order", ReorderAsync);
        channels.MapPatch("/{channelId:guid}", UpdateAsync);
        channels.MapDelete("/{channelId:guid}", DeleteAsync);
        return endpoints;
    }

    private static async Task<IResult> CreateAsync(
        CreateChannelRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var name = Normalize(request.Name);
        ChannelKind? kind = request.Kind switch
        {
            "text" => ChannelKind.Text,
            "voice" => ChannelKind.Voice,
            _ => null,
        };
        if (!IsValidName(name) || kind is null)
        {
            return Invalid("channel", "Nazwa lub typ kanału jest nieprawidłowy.");
        }

        if (await db.Channels.AnyAsync(x => x.ServerId == serverId && x.Name == name, cancellationToken))
        {
            return Results.Conflict();
        }

        if (request.SectionId is { } sectionId && !await db.Sections.AnyAsync(
                x => x.Id == sectionId && x.ServerId == serverId, cancellationToken))
        {
            return Results.NotFound();
        }

        // Inside a section, that section's override decides who may add to it.
        var userId = http.User.RequireUserId();
        var allowed = request.SectionId is { } targetSection
            ? await ServerAccess.HasForSectionAsync(
                db, userId, serverId, targetSection, ServerPrivileges.ManageChannels, cancellationToken)
            : await ServerAccess.HasAsync(db, userId, serverId, ServerPrivileges.ManageChannels, cancellationToken);
        if (!allowed)
        {
            return Results.Forbid();
        }

        var lastPosition = await db.Channels.Where(x => x.ServerId == serverId)
            .MaxAsync(x => (int?)x.Position, cancellationToken);
        var channel = new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = serverId,
            Name = name,
            Kind = kind.Value,
            Position = (lastPosition ?? -1) + 1,
            SectionId = request.SectionId,
        };
        db.Channels.Add(channel);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return Results.Conflict();
        }

        return Results.Created($"/api/admin/channels/{channel.Id}", channel.ToDto());
    }

    private static async Task<IResult> UpdateAsync(
        Guid channelId,
        UpdateChannelRequest request,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var channel = await db.Channels.FirstOrDefaultAsync(
            x => x.Id == channelId && x.ServerId == serverId, cancellationToken);
        if (channel is null)
        {
            return Results.NotFound();
        }

        if (!await ServerAccess.HasAsync(
                db, http.User.RequireUserId(), serverId, channel.Id, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        var name = request.Name is null ? null : Normalize(request.Name);
        if (name is not null && !IsValidName(name))
        {
            return Invalid("name", "Nazwa kanału jest nieprawidłowa.");
        }

        if (name is not null && await db.Channels.AnyAsync(
                x => x.ServerId == serverId && x.Id != channel.Id && x.Name == name, cancellationToken))
        {
            return Results.Conflict();
        }

        if (!AreSettingsInRange(request))
        {
            return Invalid("channel", "Co najmniej jedno ustawienie kanału jest nieprawidłowe.");
        }

        var textOnly = request.Topic is not null || request.SlowModeSeconds is not null;
        var voiceOnly = request.AudioProfile is not null || request.UserLimit is not null;
        if (channel.Kind == ChannelKind.Text ? voiceOnly : textOnly)
        {
            return Invalid("channel", "To ustawienie nie pasuje do typu kanału.");
        }

        channel.Name = name ?? channel.Name;
        channel.Topic = request.Topic?.Trim() ?? channel.Topic;
        channel.SlowModeSeconds = request.SlowModeSeconds ?? channel.SlowModeSeconds;
        channel.HideAfterInactivityHours = request.HideAfterInactivityHours ?? channel.HideAfterInactivityHours;
        channel.AudioProfile = request.AudioProfile ?? channel.AudioProfile;
        channel.UserLimit = request.UserLimit ?? channel.UserLimit;
        return await db.TrySaveChangesAsync(cancellationToken) ? Results.Ok(channel.ToDto()) : Results.Conflict();
    }

    private static async Task<IResult> ReorderAsync(
        ReorderChannelsRequest request,
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

        var channels = await db.Channels.Where(x => x.ServerId == serverId).ToListAsync(cancellationToken);
        var order = request.ChannelIds.Select((id, position) => (id, position)).ToList();
        if (order.Select(x => x.id).Distinct().Count() != order.Count ||
            !order.Select(x => x.id).ToHashSet().SetEquals(channels.Select(x => x.Id)))
        {
            return Invalid("channelIds", "Lista musi zawierać każdy kanał dokładnie raz.");
        }

        var positions = order.ToDictionary(x => x.id, x => x.position);
        foreach (var channel in channels)
        {
            channel.Position = positions[channel.Id];
        }

        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteAsync(
        Guid channelId,
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var serverId = http.RequireActiveServerId();
        var channel = await db.Channels.AsNoTracking().FirstOrDefaultAsync(
            x => x.Id == channelId && x.ServerId == serverId, cancellationToken);
        if (channel is null)
        {
            return Results.NotFound();
        }

        if (!await ServerAccess.HasAsync(
                db, http.User.RequireUserId(), serverId, channel.Id, ServerPrivileges.ManageChannels, cancellationToken))
        {
            return Results.Forbid();
        }

        // Counting and deleting are one statement. SQLite runs two of them one
        // after the other, so the second sees what the first removed and two
        // requests cannot between them take the last channel of a kind.
        var deleted = await db.Channels
            .Where(x => x.Id == channel.Id &&
                db.Channels.Count(other => other.ServerId == serverId && other.Kind == channel.Kind) > 1)
            .ExecuteDeleteAsync(cancellationToken);
        return deleted == 0 ? Results.Conflict() : Results.NoContent();
    }

    internal static string Normalize(string? name) => name?.Trim().ToLowerInvariant() ?? "";

    internal static bool IsValidName(string name) =>
        name.Length is >= 1 and <= MaxNameLength && name.All(c => char.IsLetterOrDigit(c) || c == '-');

    private static bool AreSettingsInRange(UpdateChannelRequest request) =>
        request.Topic?.Trim().Length is null or <= MaxTopicLength &&
        request.SlowModeSeconds is null or >= 0 and <= MaxSlowModeSeconds &&
        request.HideAfterInactivityHours is null or >= 0 and <= MaxHideAfterInactivityHours &&
        request.UserLimit is null or >= 0 and <= MaxUserLimit &&
        (request.AudioProfile is null || AudioProfiles.Contains(request.AudioProfile, StringComparer.Ordinal));

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
