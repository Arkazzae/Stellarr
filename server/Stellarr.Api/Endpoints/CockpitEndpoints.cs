using Microsoft.EntityFrameworkCore;
using Stellarr.Api.Auth;
using Stellarr.Api.Contracts;
using Stellarr.Api.Data;
using Stellarr.Api.Domain;
using Stellarr.Api.Realtime;

namespace Stellarr.Api.Endpoints;

/// <summary>
/// The operator panel's API: everything the owner of the instance server does
/// to the installation as a whole rather than to one server. Every route
/// answers 403 to anybody else, the owners of later servers included. The
/// routes are spread over the partial files of this class.
/// </summary>
public static partial class CockpitEndpoints
{
    public static IEndpointRouteBuilder MapCockpitEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var cockpit = endpoints.MapGroup("/api/cockpit")
            .RequireAuthorization()
            .AddEndpointFilter<InstanceOwnerFilter>();

        cockpit.MapGet("/bootstrap", GetBootstrapAsync);
        cockpit.MapGet("/activity", GetActivityAsync);
        cockpit.MapGet("/users", GetUsersAsync);
        cockpit.MapPost("/users", CreateUserAsync);
        cockpit.MapPatch("/users/{userId:guid}/role", SetUserRoleAsync);
        cockpit.MapPatch("/users/{userId:guid}/status", SetUserStatusAsync);
        cockpit.MapPost("/roles", CreateRoleAsync);
        cockpit.MapGet("/servers", GetServersAsync);
        cockpit.MapGet("/servers/{serverId:guid}/members", GetServerMembersAsync);
        cockpit.MapPost("/servers/{serverId:guid}/transfer", TransferServerAsync);
        cockpit.MapDelete("/servers/{serverId:guid}", DeleteServerAsync);
        cockpit.MapPatch("/roles/{roleId:guid}", UpdateRoleAsync);
        cockpit.MapGet("/sessions", GetSessionsAsync);
        cockpit.MapDelete("/sessions/{sessionId:guid}", RevokeSessionAsync);
        cockpit.MapGet("/runtime", GetRuntimeAsync);
        cockpit.MapGet("/logs", GetLogs);
        cockpit.MapGet("/logs/export", ExportLogs);
        cockpit.MapGet("/backups", GetBackupsAsync);
        cockpit.MapPost("/backups", CreateBackupAsync);
        cockpit.MapPost("/backups/{backupId}/verify", VerifyBackupAsync);
        cockpit.MapGet("/backups/{backupId}/download", DownloadBackup);
        cockpit.MapGet("/settings", GetSettingsAsync);
        cockpit.MapPut("/settings", UpdateSettingsAsync);
        cockpit.MapGet("/desktop-release", GetDesktopReleaseAsync);
        cockpit.MapPut("/desktop-release", UpdateDesktopReleaseAsync);
        cockpit.MapPost("/mail/test", SendTestMailAsync);
        cockpit.MapPost("/integrations/giphy/test", TestGiphyAsync);
        cockpit.MapGet("/secrets", GetSecretsAsync);
        cockpit.MapPut("/secrets/{name}", SetSecretAsync);
        cockpit.MapDelete("/secrets/{name}", ClearSecretAsync);
        return endpoints;
    }

    private static async Task<IResult> GetBootstrapAsync(
        HttpContext http,
        AppDbContext db,
        PresenceTracker presence,
        CancellationToken cancellationToken)
    {
        var server = http.RequireInstanceServer();
        var operatorUser = await db.Users.AsNoTracking()
            .SingleAsync(x => x.Id == http.User.RequireUserId(), cancellationToken);
        var memberIds = await db.ServerMembers.AsNoTracking()
            .Where(x => x.ServerId == server.Id)
            .Select(x => x.UserId)
            .ToArrayAsync(cancellationToken);
        var attachmentBytes = await db.ImageAttachments.AsNoTracking()
            .SumAsync(x => (long?)(x.SizeBytes + (x.PosterSizeBytes ?? 0)), cancellationToken) ?? 0;
        var emojiBytes = await db.ServerEmoji.AsNoTracking()
            .Where(x => x.ServerId == server.Id)
            .SumAsync(x => (long?)x.SizeBytes, cancellationToken) ?? 0;
        var messageCount = await db.Messages.AsNoTracking()
            .CountAsync(
                x => db.Channels.Any(channel => channel.Id == x.ChannelId && channel.ServerId == server.Id),
                cancellationToken);
        var serverCount = await db.Servers.AsNoTracking().CountAsync(cancellationToken);
        var publicServerCount = await db.Servers.AsNoTracking().CountAsync(x => x.IsPublic, cancellationToken);

        return Results.Ok(new CockpitBootstrapDto(
            new CockpitOperatorDto(
                operatorUser.Id.ToString(),
                operatorUser.Username,
                operatorUser.DisplayName,
                operatorUser.AvatarUrl),
            new CockpitInstanceDto(server.Id.ToString(), server.Name, server.CreatedAt),
            new CockpitOverviewDto(
                memberIds.Length,
                memberIds.Count(id => presence.PublicPresenceOf(id) != PresenceTracker.Offline),
                memberIds.Sum(id => presence.ConnectionIds(id).Count),
                attachmentBytes + emojiBytes,
                messageCount,
                serverCount,
                publicServerCount)));
    }

    /// <summary>
    /// What a desktop client says about itself in its user agent, as
    /// <c>StellarrDesktop/version CEF/version Package/kind</c>. Every field is
    /// null for any other client.
    /// </summary>
    internal static DesktopClientDescriptor DescribeClient(string userAgent)
    {
        var tokens = userAgent.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        string? ValueOf(string prefix)
        {
            var token = tokens.FirstOrDefault(x => x.StartsWith(prefix, StringComparison.Ordinal));
            var value = token?[prefix.Length..];
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        return ValueOf("StellarrDesktop/") is not { } version
            ? new DesktopClientDescriptor(null, null, null, null)
            : new DesktopClientDescriptor(
                "Stellarr Desktop",
                version,
                ValueOf("CEF/") is { } cef ? $"CEF {cef}" : null,
                ValueOf("Package/"));
    }

    /// <summary>Stages a line of the audit log; the caller saves it with the change it records.</summary>
    internal static async Task StageAuditAsync(
        AppDbContext db,
        Guid serverId,
        Guid actorId,
        string action,
        CancellationToken cancellationToken)
    {
        var actor = await db.Users.AsNoTracking()
            .Where(x => x.Id == actorId)
            .Select(x => x.DisplayName)
            .SingleAsync(cancellationToken);
        db.ServerAuditEntries.Add(new ServerAuditEntry
        {
            Id = Guid.NewGuid(),
            ServerId = serverId,
            ActorId = actorId,
            Summary = $"{actor} {action}",
            CreatedAt = DateTime.UtcNow,
        });
    }
}

internal sealed record DesktopClientDescriptor(
    string? Name,
    string? Version,
    string? Runtime,
    string? InstallType);
