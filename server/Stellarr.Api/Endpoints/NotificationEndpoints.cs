using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>A person's inbox: what was addressed to them, newest first.</summary>
public static class NotificationEndpoints
{
    private const int DefaultPageSize = 30;
    private const int MaxPageSize = 100;

    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var inbox = endpoints.MapGroup("/api/notifications")
            .RequireAuthorization()
            .AddEndpointFilter<ServerMembershipFilter>()
            .AddEndpointFilter(ForbidCaching);
        inbox.MapGet("", ListAsync);
        inbox.MapPut("/{notificationId:guid}/read", MarkReadAsync);
        inbox.MapPost("/read-all", MarkAllReadAsync);
        inbox.MapDelete("/{notificationId:guid}", DeleteAsync);
        return endpoints;
    }

    /// <summary>The inbox is private to its owner, so no cache may keep a copy.</summary>
    private static ValueTask<object?> ForbidCaching(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var headers = context.HttpContext.Response.Headers;
        headers.CacheControl = "no-store";
        headers.Pragma = "no-cache";
        headers[HeaderNames.XContentTypeOptions] = "nosniff";
        return next(context);
    }

    private static async Task<IResult> ListAsync(
        long? beforeSequence,
        int? limit,
        HttpContext http,
        AppDbContext db,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var pageSize = limit ?? DefaultPageSize;
        if (pageSize is < 1 or > MaxPageSize || beforeSequence is <= 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["page"] = [$"limit must be between 1 and {MaxPageSize} and beforeSequence must be positive."],
            });
        }

        var inbox = Shown(db, http.User.RequireUserId(), http.RequireActiveServerId(), time.GetUtcNow().UtcDateTime);
        var older = beforeSequence is { } before ? inbox.Where(x => x.Sequence < before) : inbox;
        var rows = await older
            .OrderByDescending(x => x.Sequence)
            .Take(pageSize + 1)
            .ToArrayAsync(cancellationToken);
        var page = rows.Take(pageSize).ToArray();
        return Results.Ok(new NotificationPageDto(
            page.Select(x => x.ToDto()).ToArray(),
            rows.Length > pageSize ? page[^1].Sequence : null,
            await inbox.CountAsync(x => x.ReadAt == null, cancellationToken),
            await inbox.MaxAsync(x => (long?)x.Sequence, cancellationToken) ?? 0));
    }

    private static async Task<IResult> MarkReadAsync(
        Guid notificationId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var userId = http.User.RequireUserId();
        var notification = await Owned(db, notificationId, userId, http.RequireActiveServerId())
            .SingleOrDefaultAsync(cancellationToken);
        if (notification is null)
        {
            return Results.NotFound();
        }

        if (notification.ReadAt is null)
        {
            notification.ReadAt = time.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(cancellationToken);
            await ChangedAsync(hub, userId, notification, CancellationToken.None);
        }

        return Results.Ok(notification.ToDto());
    }

    private static async Task<IResult> MarkAllReadAsync(
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var userId = http.User.RequireUserId();
        var serverId = http.RequireActiveServerId();
        var now = time.GetUtcNow().UtcDateTime;
        var changed = await Shown(db, userId, serverId, now)
            .Where(x => x.ReadAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ReadAt, now), cancellationToken);
        if (changed > 0)
        {
            // Entries of other servers may have been among them.
            await hub.Clients.Group(AppHub.UserGroup(userId)).SendAsync(
                "NotificationInboxChanged",
                new NotificationInboxChangedDto(serverId.ToString(), Sequence: null, Global: true),
                CancellationToken.None);
        }

        return Results.Ok(new { changed });
    }

    private static async Task<IResult> DeleteAsync(
        Guid notificationId,
        HttpContext http,
        AppDbContext db,
        IHubContext<AppHub> hub,
        CancellationToken cancellationToken)
    {
        var userId = http.User.RequireUserId();
        var notification = await Owned(db, notificationId, userId, http.RequireActiveServerId())
            .SingleOrDefaultAsync(cancellationToken);
        if (notification is null)
        {
            return Results.NotFound();
        }

        db.UserNotifications.Remove(notification);
        await db.SaveChangesAsync(cancellationToken);
        await ChangedAsync(hub, userId, notification, CancellationToken.None);
        return Results.NoContent();
    }

    /// <summary>
    /// What the inbox lists and counts: the notifications of the active
    /// server, and the invitations to other servers for as long as the invite
    /// can still be used.
    /// </summary>
    private static IQueryable<UserNotification> Shown(AppDbContext db, Guid userId, Guid serverId, DateTime now) =>
        db.UserNotifications.AsNoTracking().Where(notification =>
            notification.UserId == userId &&
            (notification.ServerId == serverId ||
                (notification.Source == "system" &&
                    notification.TargetInviteCode != null &&
                    db.ServerInvites.Any(invite =>
                        invite.ServerId == notification.ServerId &&
                        invite.Code == notification.TargetInviteCode &&
                        (invite.ExpiresAt == null || invite.ExpiresAt > now) &&
                        (invite.MaxUses == null || invite.Uses < invite.MaxUses)))));

    /// <summary>
    /// The notification of this person that is theirs to read or dismiss.
    /// An invitation stays dismissable after it can no longer be used.
    /// </summary>
    private static IQueryable<UserNotification> Owned(
        AppDbContext db,
        Guid notificationId,
        Guid userId,
        Guid serverId) =>
        db.UserNotifications.Where(notification =>
            notification.Id == notificationId &&
            notification.UserId == userId &&
            (notification.ServerId == serverId ||
                (notification.Source == "system" && notification.TargetInviteCode != null)));

    private static Task ChangedAsync(
        IHubContext<AppHub> hub,
        Guid userId,
        UserNotification notification,
        CancellationToken cancellationToken) =>
        hub.Clients.Group(AppHub.UserGroup(userId)).SendAsync(
            "NotificationInboxChanged",
            new NotificationInboxChangedDto(
                notification.ServerId.ToString(),
                notification.Sequence,
                Global: notification.TargetInviteCode is not null),
            cancellationToken);
}
