using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;

namespace Stellarr.Api.Realtime;

/// <summary>
/// The one realtime connection of a signed-in client. Everything the server
/// pushes reaches clients through the groups named here: one per account, one
/// per server and one per text channel a client opened.
/// </summary>
[Authorize]
public sealed partial class AppHub(
    AppDbContext db,
    PresenceTracker presence,
    SoundboardPlaybackGate soundboardGate,
    HubThrottleGate throttle,
    MediaPlane mediaPlane,
    MediaControlClient mediaControl,
    ILogger<AppHub> logger) : Hub
{
    private static readonly TimeSpan TypingLifetime = TimeSpan.FromSeconds(6);

    public static string ServerGroup(Guid serverId) => $"server:{serverId:N}";

    public static string ChannelGroup(Guid channelId) => $"channel:{channelId:N}";

    public static string UserGroup(Guid userId) => $"user:{userId:N}";

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.RequireUserId();
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId));

        // A connection follows one server at a time: the one the client asked
        // for with ?serverId=, else the first it belongs to. That keeps one
        // server's traffic away from clients that are looking at another.
        var serverIds = await MemberServerIdsAsync(userId);
        var requested = Context.GetHttpContext()?.Request.Query["serverId"].FirstOrDefault();
        var activeServerId = Guid.TryParse(requested, out var requestedId) && serverIds.Contains(requestedId)
            ? requestedId
            : serverIds.FirstOrDefault();
        if (activeServerId != Guid.Empty)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ServerGroup(activeServerId));
        }

        var showPresence = await db.UserPreferences.AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => (bool?)x.ShowPresence)
            .SingleOrDefaultAsync() ?? true;
        var becameConnected = presence.Connect(Context.ConnectionId, userId, showPresence);

        // Only the first connection changes what others see. Every connection
        // still gets its own answer, because two tabs may have loaded while
        // the account was offline and then race to connect.
        if (becameConnected)
        {
            await Clients.Groups(serverIds.Select(ServerGroup))
                .SendAsync("PresenceChanged", PresenceUpdate(userId, presence.PublicPresenceOf(userId)));
        }
        await Clients.Caller.SendAsync("PresenceChanged", PresenceUpdate(userId, presence.PresenceOf(userId)));

        await RestoreDirectCallSnapshotsAsync(userId);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var (becameOffline, departure) = presence.Disconnect(Context.ConnectionId);
        if (departure is not null)
        {
            await BroadcastVoiceSnapshotAsync(departure.ChannelId);
        }

        if (becameOffline && Context.User is { } user)
        {
            var userId = user.RequireUserId();
            var groups = (await MemberServerIdsAsync(userId)).Select(ServerGroup);
            await Clients.Groups(groups).SendAsync("PresenceChanged", PresenceUpdate(userId, PresenceTracker.Offline));
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task SetPresence(string value)
    {
        if (!PresenceTracker.IsSupportedPresence(value))
        {
            throw new HubException("Unknown presence.");
        }

        var userId = Context.User!.RequireUserId();
        if (!presence.SetPresence(userId, value))
        {
            return;
        }

        var groups = (await MemberServerIdsAsync(userId)).Select(ServerGroup);
        await Clients.Groups(groups).SendAsync("PresenceChanged", PresenceUpdate(userId, presence.PublicPresenceOf(userId)));
        await Clients.Caller.SendAsync("PresenceChanged", PresenceUpdate(userId, value));
    }

    /// <summary>Starts delivering the events of one text channel to this connection.</summary>
    public async Task JoinChannel(string channelId)
    {
        var id = ParseGuid(channelId, nameof(channelId));
        if (await TextChannelServerIdAsync(id, Context.User!.RequireUserId()) is null)
        {
            throw new HubException("Unknown channel.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, ChannelGroup(id));
    }

    /// <summary>Tells the other members of the server that this account is typing in a text channel.</summary>
    public async Task SendTyping(string channelId)
    {
        // One broadcast reaches the server's whole group and costs two lookups,
        // so the cadence is decided here rather than trusted to every client.
        if (!throttle.TryAcquire(Context.ConnectionId, HubThrottleGate.Policy.Typing))
        {
            throw new HubException("Typing is too fast.");
        }

        var id = ParseGuid(channelId, nameof(channelId));
        var userId = Context.User!.RequireUserId();
        if (await TextChannelServerIdAsync(id, userId) is not { } serverId)
        {
            throw new HubException("Unknown channel.");
        }

        var displayName = await db.Users.Where(user => user.Id == userId)
            .Select(user => user.DisplayName)
            .SingleAsync();
        await Clients.OthersInGroup(ServerGroup(serverId)).SendAsync(
            "TypingChanged",
            new TypingChangedDto(
                id.ToString(),
                userId.ToString(),
                displayName,
                DateTime.UtcNow + TypingLifetime));
    }

    /// <summary>The server's UTC clock in Unix milliseconds, which clients use to correct for their own skew.</summary>
    public long GetRtcClock() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static object PresenceUpdate(Guid userId, string presence) => new { userId = userId.ToString(), presence };

    private static Guid ParseGuid(string value, string field) =>
        Guid.TryParse(value, out var parsed) ? parsed : throw new HubException($"Invalid {field}.");

    private async Task<Guid[]> MemberServerIdsAsync(Guid userId) =>
        await db.ServerMembers.AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.ServerId)
            .ToArrayAsync();

    /// <summary>The server of a text channel the account can see, or null when there is no such channel for it.</summary>
    private async Task<Guid?> TextChannelServerIdAsync(Guid channelId, Guid userId) =>
        await db.Channels.AsNoTracking()
            .Where(x => x.Id == channelId &&
                x.Kind == ChannelKind.Text &&
                db.ServerMembers.Any(member => member.ServerId == x.ServerId && member.UserId == userId))
            .Select(x => (Guid?)x.ServerId)
            .SingleOrDefaultAsync();
}
