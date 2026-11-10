using Stellarr.Api.Domain;

namespace Stellarr.Api.Contracts;

/// <param name="Reason">Shown to moderators in the ban list; without one a standard text is stored.</param>
public sealed record BanMemberRequest(string? Reason);

public sealed record ServerBanDto(
    string UserId,
    string DisplayName,
    string BannedByName,
    string Reason,
    DateTime BannedAt);

public static class ModerationContractMappings
{
    /// <remarks>The ban's user and moderator must be loaded.</remarks>
    public static ServerBanDto ToDto(this ServerBan ban) => new(
        ban.UserId.ToString(),
        ban.User.DisplayName,
        ban.BannedBy.DisplayName,
        ban.Reason,
        ban.BannedAt.AsUtc());
}
