using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Localization;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>Finding, creating and joining servers, for people who are not yet in them.</summary>
public static class ServerDirectoryEndpoints
{
    private const int MaxNameLength = 80;
    private const int MaxDescriptionLength = 280;
    private const int DiscoverPageSize = 100;
    private const string DefaultTextChannelName = "ogólny";
    private const string DefaultVoiceChannelName = "rozmowa";

    /// <summary>What a new server starts with.</summary>
    /// <param name="VoiceChannelName">The first voice channel; none when null.</param>
    internal sealed record StarterServer(
        string Name,
        string Description = "",
        bool IsPublic = false,
        string TextChannelName = DefaultTextChannelName,
        string? VoiceChannelName = DefaultVoiceChannelName,
        bool MentionsOnly = true,
        bool VoiceJoinSound = true);

    /// <summary>The outcome of staging a person's membership of a server.</summary>
    /// <param name="Refusal">What to answer when the person may not join; otherwise null.</param>
    /// <param name="Added">False when the person was a member already.</param>
    private sealed record Admission(IResult? Refusal, bool Added, Message? Welcome);

    public static IEndpointRouteBuilder MapServerDirectoryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var servers = endpoints.MapGroup("/api/servers").RequireAuthorization();
        servers.MapGet("", ListAsync);
        servers.MapGet("/discover", DiscoverAsync);
        servers.MapPost("", CreateAsync);
        servers.MapPost("/{serverId:guid}/join", JoinPublicAsync);
        endpoints.MapPost("/api/invites/{code}/join", JoinWithInviteAsync).RequireAuthorization();
        return endpoints;
    }

    /// <summary>
    /// Stages a server with its two system roles, its starter channels and its
    /// notification defaults. The caller adds the first member, who owns it.
    /// </summary>
    internal static (StellarrServer Server, ServerRole OwnerRole) AddServer(
        AppDbContext db,
        StarterServer starter,
        DateTime now)
    {
        var server = new StellarrServer
        {
            Id = Guid.NewGuid(),
            Name = starter.Name,
            Description = starter.Description,
            IsPublic = starter.IsPublic,
            CreatedAt = now,
        };
        var ownerRole = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Właściciel",
            Color = "oklch(0.72 0.16 15)",
            Permissions = ServerPrivileges.All,
            Position = 0,
            IsSystem = true,
            IsOwner = true,
        };
        var memberRole = new ServerRole
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = "Członek",
            Color = "oklch(0.70 0.02 277)",
            Permissions = ServerPrivileges.None,
            Position = 1,
            IsSystem = true,
        };

        db.Servers.Add(server);
        db.ServerRoles.AddRange(ownerRole, memberRole);
        db.Channels.Add(new Channel
        {
            Id = Guid.NewGuid(),
            ServerId = server.Id,
            Name = starter.TextChannelName,
            Kind = ChannelKind.Text,
            Position = 0,
        });
        if (starter.VoiceChannelName is not null)
        {
            db.Channels.Add(new Channel
            {
                Id = Guid.NewGuid(),
                ServerId = server.Id,
                Name = starter.VoiceChannelName,
                Kind = ChannelKind.Voice,
                Position = 1,
            });
        }

        db.ServerAdminSettings.Add(new ServerAdminSettings
        {
            ServerId = server.Id,
            MentionsOnly = starter.MentionsOnly,
            AllMessages = !starter.MentionsOnly,
            VoiceJoinSound = starter.VoiceJoinSound,
        });
        return (server, ownerRole);
    }

    private static async Task<IResult> ListAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = http.User.RequireUserId();
        var servers = await db.ServerMembers.AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderBy(x => x.JoinedAt)
            .Join(db.Servers, member => member.ServerId, server => server.Id, (_, server) => server)
            .ToListAsync(cancellationToken);
        return Results.Ok(servers.Select(x => x.ToDto()));
    }

    /// <summary>The public servers the caller is neither in nor banned from, newest first.</summary>
    private static async Task<IResult> DiscoverAsync(
        HttpContext http,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = http.User.RequireUserId();
        var servers = await db.Servers.AsNoTracking()
            .Where(server => server.IsPublic &&
                !db.ServerMembers.Any(x => x.ServerId == server.Id && x.UserId == userId) &&
                !db.ServerBans.Any(x => x.ServerId == server.Id && x.UserId == userId))
            .OrderByDescending(server => server.CreatedAt)
            .Take(DiscoverPageSize)
            .ToListAsync(cancellationToken);
        return Results.Ok(servers.Select(x => x.ToDto()));
    }

    private static async Task<IResult> CreateAsync(
        CreateServerRequest request,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";
        if (name.Length is < 1 or > MaxNameLength || description.Length > MaxDescriptionLength)
        {
            return Invalid("server", messages.Get(MessageKey.ServerNameOrDescriptionInvalid));
        }

        // An omitted channel name keeps the usual start. A voice name that is
        // given but empty is how a server is created without a voice channel.
        var textChannelName = ChannelEndpoints.Normalize(request.TextChannelName ?? DefaultTextChannelName);
        var voiceChannelName = ChannelEndpoints.Normalize(request.VoiceChannelName ?? DefaultVoiceChannelName);
        var wantsVoice = voiceChannelName.Length > 0;
        if (!ChannelEndpoints.IsValidName(textChannelName) ||
            (wantsVoice && !ChannelEndpoints.IsValidName(voiceChannelName)))
        {
            return Invalid("channels", messages.Get(MessageKey.StarterChannelNameInvalid));
        }

        if (wantsVoice && textChannelName == voiceChannelName)
        {
            return Invalid("channels", messages.Get(MessageKey.StarterChannelNamesCollide));
        }

        var now = DateTime.UtcNow;
        var (server, ownerRole) = AddServer(
            db,
            new StarterServer(
                name,
                description,
                request.IsPublic,
                textChannelName,
                wantsVoice ? voiceChannelName : null,
                request.MentionsOnly ?? true,
                request.VoiceJoinSound ?? true),
            now);
        var ownerId = http.User.RequireUserId();
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = server.Id,
            UserId = ownerId,
            RoleId = ownerRole.Id,
            OwnerSlot = 1,
            JoinedAt = now,
        });
        var owner = await db.Users.SingleAsync(x => x.Id == ownerId, cancellationToken);
        var welcome = await ServerWelcome.CreateAsync(db, server.Id, owner, now, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        await ServerWelcome.PublishAsync(hub, server.Id, welcome, CancellationToken.None);
        return Results.Created($"/api/servers/{server.Id}", server.ToDto());
    }

    private static async Task<IResult> JoinPublicAsync(
        Guid serverId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var server = await db.Servers.FirstOrDefaultAsync(x => x.Id == serverId && x.IsPublic, cancellationToken);
        if (server is null)
        {
            return Results.NotFound();
        }

        var userId = http.User.RequireUserId();
        var admission = await AdmitAsync(db, server, userId, messages, cancellationToken);
        if (admission.Refusal is { } refusal)
        {
            return refusal;
        }

        await FinishJoinAsync(db, hub, server, userId, admission, invite: null, cancellationToken);
        return Results.Ok(server.ToDto());
    }

    private static async Task<IResult> JoinWithInviteAsync(
        string code,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        Messages messages,
        CancellationToken cancellationToken)
    {
        var normalized = code.Trim().ToLowerInvariant();
        var now = DateTime.UtcNow;
        var invite = await db.ServerInvites.Include(x => x.Channel)
            .FirstOrDefaultAsync(x => x.Code == normalized, cancellationToken);
        if (invite is null || invite.ExpiresAt <= now || invite.MaxUses <= invite.Uses)
        {
            return Results.NotFound();
        }

        var server = await db.Servers.FindAsync([invite.ServerId], cancellationToken);
        if (server is null)
        {
            return Results.NotFound();
        }

        var userId = http.User.RequireUserId();
        var admission = await AdmitAsync(db, server, userId, messages, cancellationToken);
        if (admission.Refusal is { } refusal)
        {
            return refusal;
        }

        await FinishJoinAsync(db, hub, server, userId, admission, invite, cancellationToken);
        return Results.Ok(server.ToJoinResponse(invite));
    }

    /// <summary>Stages the membership and the welcome notice; the caller saves them.</summary>
    private static async Task<Admission> AdmitAsync(
        AppDbContext db,
        StellarrServer server,
        Guid userId,
        Messages messages,
        CancellationToken cancellationToken)
    {
        if (await db.ServerBans.AnyAsync(x => x.ServerId == server.Id && x.UserId == userId, cancellationToken))
        {
            return new Admission(Results.Forbid(), Added: false, Welcome: null);
        }

        if (await db.ServerMembers.AnyAsync(x => x.ServerId == server.Id && x.UserId == userId, cancellationToken))
        {
            return new Admission(Refusal: null, Added: false, Welcome: null);
        }

        if (await ServerAccess.FindMemberRoleAsync(db, server.Id, cancellationToken) is not { } role)
        {
            return new Admission(
                Results.Problem(
                    statusCode: StatusCodes.Status503ServiceUnavailable,
                    title: messages.Get(MessageKey.ServerHasNoMemberRole)),
                Added: false,
                Welcome: null);
        }

        var joinedAt = DateTime.UtcNow;
        db.ServerMembers.Add(new ServerMember
        {
            ServerId = server.Id,
            UserId = userId,
            RoleId = role.Id,
            JoinedAt = joinedAt,
        });
        var user = await db.Users.SingleAsync(x => x.Id == userId, cancellationToken);
        var welcome = await ServerWelcome.CreateAsync(db, server.Id, user, joinedAt, cancellationToken);
        return new Admission(Refusal: null, Added: true, welcome);
    }

    /// <summary>
    /// Saves the membership, counts the use of the invite that led to it and
    /// clears the invitations to the server from the person's inbox, since
    /// they have been answered. Somebody who is a member already gets the same
    /// answer, and so does a request that lost a race with its own twin.
    /// </summary>
    private static async Task FinishJoinAsync(
        AppDbContext db,
        IHubContext<AppHub> hub,
        StellarrServer server,
        Guid userId,
        Admission admission,
        ServerInvite? invite,
        CancellationToken cancellationToken)
    {
        if (admission.Added && invite is not null)
        {
            invite.Uses++;
        }

        var invitations = await db.UserNotifications
            .Where(x => x.UserId == userId &&
                x.ServerId == server.Id &&
                x.Source == "system" &&
                x.TargetInviteCode != null)
            .ToListAsync(cancellationToken);
        db.UserNotifications.RemoveRange(invitations);
        if (!await db.TrySaveChangesAsync(cancellationToken))
        {
            return;
        }

        await ServerWelcome.PublishAsync(hub, server.Id, admission.Welcome, CancellationToken.None);
        if (invitations.Count > 0)
        {
            await NotificationEndpoints.InvitationsChangedAsync(hub, userId, server.Id, CancellationToken.None);
        }
    }

    private static IResult Invalid(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
