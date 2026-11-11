using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Integrations;
using Stellarr.Api.Localization;
using Stellarr.Api.Messaging;
using Stellarr.Api.Realtime;
using Stellarr.Api.Secrets;

namespace Stellarr.Api.Endpoints;

/// <summary>The snapshot a client loads when it starts, and the runtime settings it needs next to it.</summary>
public static class BootstrapEndpoints
{
    private const int FirstPageSize = 100;

    public static IEndpointRouteBuilder MapBootstrapEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/bootstrap", GetBootstrapAsync)
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>();

        // GIPHY's browser key is a public web-integration credential. Serving it
        // at run time lets the operator set it and turn GIFs on or off in
        // Cockpit, with no rebuild of the web client and no restart.
        endpoints.MapGet("/api/config/giphy", GetGiphyConfigAsync).RequireAuthorization();

        return endpoints;
    }

    /// <summary>Whether the web client offers GIFs, with the key when it does.</summary>
    private static async Task<IResult> GetGiphyConfigAsync(
        AppDbContext db,
        InstanceSecrets secrets,
        CancellationToken cancellationToken)
    {
        var instanceId = await db.Servers.AsNoTracking()
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
        var settings = instanceId is null
            ? null
            : await db.OperationsSettings.AsNoTracking()
                .SingleOrDefaultAsync(x => x.ServerId == instanceId, cancellationToken);
        var giphy = GiphyState.Resolve(settings, await secrets.ReadAsync(cancellationToken));
        return Results.Ok(new { giphy.Enabled, giphy.ApiKey });
    }

    private static async Task<IResult> GetBootstrapAsync(
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        TurnCredentialService turnCredentials,
        MediaServerSettings mediaServer,
        Messages messages,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var userId = http.User.RequireUserId();
        var serverId = http.RequireActiveServerId();

        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == userId, cancellationToken);
        var server = await db.Servers.AsNoTracking().SingleAsync(x => x.Id == serverId, cancellationToken);
        var servers = await db.ServerMembers.AsNoTracking()
            .Where(x => x.UserId == userId)
            .OrderBy(x => x.JoinedAt)
            .Join(db.Servers, member => member.ServerId, joined => joined.Id, (_, joined) => joined)
            .ToListAsync(cancellationToken);
        var channels = await db.Channels.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.Position)
            .ToListAsync(cancellationToken);
        var sections = await db.Sections.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .OrderBy(x => x.Position)
            .ToListAsync(cancellationToken);
        var members = await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == serverId)
            .Select(x => x.User)
            .OrderBy(x => x.DisplayName)
            .ToListAsync(cancellationToken);
        var permissions = await ServerAccess.GetAsync(db, userId, serverId, cancellationToken);

        var textChannels = channels.Where(x => x.Kind == ChannelKind.Text).ToList();
        var reads = await LoadReadMarkersAsync(db, userId, textChannels, cancellationToken);
        var recent = textChannels.Count == 0
            ? []
            : await db.Messages.AsNoTracking()
                .WithMessageDetails()
                .Where(x => x.ChannelId == textChannels[0].Id)
                .OrderByDescending(x => x.CreatedAt)
                .Take(FirstPageSize)
                .AsSplitQuery()
                .ToListAsync(cancellationToken);

        var memberNames = members.ToDictionary(x => x.Id, x => x.DisplayName);
        var voice = channels
            .Where(x => x.Kind == ChannelKind.Voice)
            .ToDictionary(
                x => x.Id.ToString(),
                x => (IReadOnlyList<VoiceOccupantDto>)presence.VoiceUsers(x.Id)
                    .Where(occupant => memberNames.ContainsKey(occupant.UserId))
                    .Select(occupant => new VoiceOccupantDto(
                        occupant.UserId.ToString(),
                        memberNames[occupant.UserId],
                        occupant.Muted))
                    .ToArray());

        return Results.Ok(new BootstrapDto(
            user.ToDto(presence.PresenceOf(userId)),
            server.ToDto(),
            servers.Select(x => x.ToDto()).ToArray(),
            channels.Select(x => x.ToDto()).ToArray(),
            sections.Select(x => x.ToDto()).ToArray(),
            members.Select(x => x.ToDto(presence.PublicPresenceOf(x.Id, userId))).ToArray(),
            recent.OrderBy(x => x.CreatedAt).Select(x => x.ToDto(messages, userId)).ToArray(),
            reads,
            voice,
            BuildRtcConfiguration(configuration, turnCredentials.Create(userId), mediaServer),
            ServerAccess.ToNames(permissions)));
    }

    /// <summary>
    /// The caller's read marker of every text channel. A channel the caller has
    /// never opened is marked read as of now, so that a new member does not
    /// start out with the whole history unread.
    /// </summary>
    private static async Task<Dictionary<string, DateTime>> LoadReadMarkersAsync(
        AppDbContext db,
        Guid userId,
        List<Channel> textChannels,
        CancellationToken cancellationToken)
    {
        var channelIds = textChannels.Select(x => x.Id).ToList();

        while (true)
        {
            var markers = await db.ChannelReads
                .Where(x => x.UserId == userId && channelIds.Contains(x.ChannelId))
                .ToDictionaryAsync(x => x.ChannelId, x => x.LastReadAt, cancellationToken);

            var missing = channelIds.Where(id => !markers.ContainsKey(id)).ToList();
            if (missing.Count > 0)
            {
                var now = DateTime.UtcNow;
                db.ChannelReads.AddRange(
                    missing.Select(id => new ChannelRead { ChannelId = id, UserId = userId, LastReadAt = now }));
                try
                {
                    await db.SaveChangesAsync(cancellationToken);
                }
                catch (DbUpdateException exception) when (DatabaseErrors.IsUniqueConstraint(exception))
                {
                    // A second bootstrap of the same user, such as another tab, stored some of
                    // these markers first and the whole insert was rolled back. Forget the failed
                    // rows and read again, so that the answer carries what is stored. Each round
                    // means one more marker exists, which is why the loop ends.
                    db.ChangeTracker.Clear();
                    continue;
                }

                foreach (var id in missing)
                {
                    markers[id] = now;
                }
            }

            return markers.ToDictionary(x => x.Key.ToString(), x => x.Value.AsUtc());
        }
    }

    /// <remarks>
    /// Every voice room goes through the media server. TURN stays in the ICE
    /// servers for browsers on networks that block UDP.
    /// </remarks>
    private static RtcConfigurationDto BuildRtcConfiguration(
        IConfiguration configuration,
        TurnCredentials turn,
        MediaServerSettings mediaServer)
    {
        var host = configuration["Rtc:PublicHost"] ?? "localhost";
        var turnPort = configuration.GetValue("Rtc:TurnPort", 3478);
        var turnsPort = configuration.GetValue("Rtc:TurnsPort", 5349);
        var turnsEnabled = configuration.GetValue("Rtc:TurnsEnabled", true);
        if (turnPort is < 1 or > 65535)
        {
            throw new InvalidOperationException("Rtc:TurnPort must be between 1 and 65535.");
        }

        if (turnsEnabled && turnsPort is < 1 or > 65535)
        {
            throw new InvalidOperationException("Rtc:TurnsPort must be between 1 and 65535.");
        }

        var turnUrls = new List<string> { $"turn:{host}:{turnPort}?transport=udp" };
        if (configuration.GetValue("Rtc:TurnTcpEnabled", true))
        {
            turnUrls.Add($"turn:{host}:{turnPort}?transport=tcp");
        }

        var iceServers = new List<IceServerDto>
        {
            new([$"stun:{host}:{turnPort}"], null, null),
            new(turnUrls, turn.Username, turn.Credential),
        };
        if (turnsEnabled)
        {
            iceServers.Add(new IceServerDto([$"turns:{host}:{turnsPort}?transport=tcp"], turn.Username, turn.Credential));
        }

        return new RtcConfigurationDto(
            ProtocolVersion: RtcProtocol.Version,
            Capabilities: new RtcCapabilitiesDto(
                AudioCodecs: ["opus"],
                VideoCodecs: ["vp9", "vp8", "h264"],
                AudioProcessing: ["browser", "rnnoise", "gtcrn", "speex", "gate"],
                Camera: true,
                ScreenShare: true,
                ScreenAudio: true),
            IceServers: iceServers,
            SignalingHub: "/hubs/app",
            MediaServer: mediaServer.PublicEndpoint(host));
    }
}
