using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

/// <summary>Where a notification came from, as it was when it was delivered.</summary>
/// <param name="Type">Who sent it; "system" for the server itself.</param>
public sealed record NotificationSourceDto(
    string Type,
    string PackageId,
    string PackageName,
    string ModuleId,
    string ModuleName);

/// <summary>What opening a notification leads to.</summary>
/// <param name="Type">"channel" or "server-invite"; the other fields belong to one of them.</param>
public sealed record NotificationTargetDto(
    string Type,
    string? ChannelId = null,
    string? InviteCode = null,
    string? ServerId = null,
    string? ServerName = null,
    string? InvitedByName = null);

public sealed record NotificationDto(
    string Id,
    long Sequence,
    string Title,
    string Body,
    string Tone,
    NotificationSourceDto Source,
    NotificationTargetDto? Target,
    DateTime CreatedAt,
    DateTime? ReadAt);

/// <summary>One page of a person's inbox, newest first.</summary>
/// <param name="NextBeforeSequence">Where the next page starts; null at the end of the inbox.</param>
/// <param name="UnreadCount">Across the whole inbox, not only this page.</param>
/// <param name="LastSequence">The newest entry's position, 0 for an empty inbox.</param>
public sealed record NotificationPageDto(
    IReadOnlyList<NotificationDto> Items,
    long? NextBeforeSequence,
    int UnreadCount,
    long LastSequence);

/// <summary>
/// Pushed to a person's own connections when their inbox changed.
/// </summary>
/// <param name="Sequence">The entry that changed, or null when several did.</param>
/// <param name="Global">
/// Set when the change may concern entries of other servers too, such as
/// invitations, so a client has to reload the inbox rather than one server's.
/// </param>
public sealed record NotificationInboxChangedDto(string ServerId, long? Sequence, bool Global);

public static class NotificationContractMappings
{
    public static NotificationDto ToDto(this UserNotification notification) => new(
        notification.Id.ToString(),
        notification.Sequence,
        notification.Title,
        notification.Body,
        notification.Tone,
        new NotificationSourceDto(
            notification.Source,
            notification.SourcePackageId,
            notification.SourcePackageName,
            notification.SourceModuleId,
            notification.SourceModuleName),
        TargetOf(notification),
        notification.CreatedAt,
        notification.ReadAt);

    /// <remarks>
    /// An invitation keeps the server's name and the inviter's in the source
    /// columns it was delivered with.
    /// </remarks>
    private static NotificationTargetDto? TargetOf(UserNotification notification) =>
        notification.TargetInviteCode is { } inviteCode
            ? new NotificationTargetDto(
                "server-invite",
                InviteCode: inviteCode,
                ServerId: notification.ServerId.ToString(),
                ServerName: notification.SourcePackageName,
                InvitedByName: notification.SourceModuleName)
            : notification.TargetChannelId is { } channelId
                ? new NotificationTargetDto("channel", ChannelId: channelId.ToString())
                : null;
}
